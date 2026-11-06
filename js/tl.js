/* Reader for the Crown "TL" workbook (e.g. "TL 26.10.2026-1.11.2026.xlsx").
 *
 * The workbook has one tab per day and team: MON- GB (1), MON-BAR, FRI-BAR (1), ...
 * Only the BAR tabs are read. Each BAR tab looks like:
 *
 *   B1 "BARS"                                  K1 "Monday, October 26, 2026"
 *   B3 "MANAGER"   C3 "Cedric"
 *   row 5: Name | ID | Start | 1/2 | 1st 15 | 2nd 15 | Finish | Hours | Bar | Duties
 *   rows 6+: Name / Start / Bar per person. BOLD Duties text = event name; the people under it
 *            work that event. Non-bold Duties text = the team's after-event jobs. A row with a
 *            start time but no name (highlighted yellow) is an unfilled spot.
 *   "Bar Hrs:" / "CLOSING DUTIES" marks the end of the staff list.
 */
(function (global) {
  'use strict';
  const P = () => global.CrownParse;

  const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  // MON-BAR, FRI-BAR (1), MON BAR, Monday Bars, BAR - MON … (but not MON- GB, MON-SET UP, etc.)
  const BAR_TAB = /^\s*(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b.*\bbars?\b|^\s*bars?\b.*\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/i;
  const NOT_WORKING = /^(rej|rejected|cancel+ed|cxl|no show|ns|sick|off)$/i;

  const isBarTab = (name) => BAR_TAB.test(name);
  const norm = (v) => String(v == null ? '' : v).trim();
  const low = (v) => norm(v).toLowerCase();

  /** "TUESTA MELENDEZ , Leisly" → "Leisly Tuesta Melendez" */
  function niceName(raw) {
    const s = norm(raw).replace(/\s+/g, ' ');
    const cap = (w) => w.toLowerCase().replace(/(^|[\s\-'])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
    const i = s.indexOf(',');
    if (i < 0) return cap(s);
    const last = s.slice(0, i).trim(), first = s.slice(i + 1).trim();
    return first ? `${cap(first)} ${cap(last)}` : cap(last);
  }

  /** First dd.mm.yyyy in the file name = Monday of the week. */
  function weekStartFromName(fileName) {
    const m = String(fileName || '').match(/(\d{1,2})[.\-_\/](\d{1,2})[.\-_\/](\d{4})/);
    return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
  }

  function findHeader(rows) {
    for (let r = 0; r < Math.min(rows.length, 15); r++) {
      const row = rows[r] || [];
      const idx = (re) => row.findIndex((c) => re.test(low(c)));
      const name = idx(/^name$/), duties = idx(/^dut(y|ies)$/), bar = idx(/^bar$/);
      if (name >= 0 && (duties >= 0 || bar >= 0)) {
        return { r, name, duties, bar, start: idx(/^start$/), finish: idx(/^finish$/), id: idx(/^id$/) };
      }
    }
    return null;
  }

  function readBarTab(sheetName, rows, fileName, fmt) {
    const warnings = [];
    const h = findHeader(rows);
    if (!h) return { events: [], shifts: [], warnings: [`${sheetName}: couldn't find the Name / Bar / Duties headings.`] };

    // Date: any date-looking cell above the headings, else day prefix + week in file name.
    let date = null, manager = '';
    for (let r = 0; r < h.r; r++) {
      const row = rows[r] || [];
      for (let c = 0; c < row.length; c++) {
        if (!date && typeof row[c] !== 'number') date = P().toISODate(row[c]);
        if (/^manager$/i.test(norm(row[c]))) manager = norm(row.slice(c + 1).find((x) => norm(x)) || '');
      }
    }
    // The day the tab name and the workbook's week point to (e.g. "SAT-BAR" in "TL 2.11.2026-8.11.2026" → 7 Nov).
    const ws = weekStartFromName(fileName), dm = sheetName.toUpperCase().match(/\b(MON|TUE|WED|THU|FRI|SAT|SUN)/), day = dm ? DAYS.indexOf(dm[1]) : -1;
    let tabDate = null;
    if (ws && day >= 0) { const d = new Date(ws); d.setDate(d.getDate() + day); tabDate = P().isoOf(d); }
    if (!date) date = tabDate;
    else if (ws) {
      // A date cell outside this workbook's week (e.g. a tab copied from last week, date not updated)
      // would put the tab on the wrong day: trust the tab name + week instead.
      const start = P().isoOf(ws), endD = new Date(ws); endD.setDate(endD.getDate() + 6);
      if ((date < start || date > P().isoOf(endD)) && tabDate) {
        warnings.push(`${sheetName}: its date cell says ${date}, which isn't in this workbook's week, so ${tabDate} (from the tab name) was used.`);
        date = tabDate;
      }
    }
    if (!date) return { events: [], shifts: [], warnings: [`${sheetName}: couldn't work out the date.`] };

    /* How a bar tab is laid out (from the real sheets):
     *  - A BOLD entry in Duties is an event name. Everyone listed under it, up to the next bold
     *    entry, works that event. The Bar column cross-checks this: a row whose bar belongs to an
     *    earlier event joins that one.
     *  - Non-bold Duties text is the team's job list for after their event
     *    ("GB1 - CLEAN & RESET FOR LGPA COCKTAIL"). It's attached by bar code, else to the event
     *    whose block it sits in. Lines on consecutive rows are one task.
     *  - A row with no name but a start time (usually highlighted yellow) is an unfilled spot.
     */
    const ctx = fmt || {};
    const isBold = (r) => (ctx.bold ? ctx.bold(r, h.duties) : null);
    const isYellow = (r) => (ctx.yellow ? ctx.yellow(r, h.name) : false);
    // Trust bold only if some Duties entry on this tab is actually bold; otherwise fall back to guessing.
    let anyBoldInfo = false;
    if (ctx.bold && ctx.hasBold && h.duties >= 0) {
      for (let r = h.r + 1; r < rows.length && !anyBoldInfo; r++) if (norm((rows[r] || [])[h.duties]) && ctx.bold(r, h.duties)) anyBoldInfo = true;
    }
    const CODE = /^([A-Z0-9&]{1,8})\s*[-–]\s+/;          // "GB1 - ", "CB1&2 - ", "AST - "
    const SETUP = /^set\s*up\b/i;

    const blocks = [];
    const skipped = [];
    let current = null;
    const sameName = (x) => String(x).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
    const newBlock = (title, r, bar, auto) => {
      const kind = SETUP.test(title) || SETUP.test(bar || '') ? 'setup' : 'event';
      const name = kind === 'setup' ? 'Set up team' : title;
      // The same event name written again (e.g. on every row, or further down the tab) continues that event.
      const again = blocks.find((x) => sameName(x.title) === sameName(name));
      if (again) {
        if (bar && !again.bars.includes(bar)) again.bars.push(bar);
        again.starts.push(r); current = again; return again;
      }
      const b = { date, title: name, row: r, starts: [r], bars: bar ? [bar] : [], staffDetail: [], missing: [], tasks: [], auto: !!auto, kind };
      blocks.push(b); current = b; return b;
    };
    const barMatch = (b, bar) => !bar || !b.bars.length || b.bars.includes(bar);
    const pick = (r, bar) => {
      if (current && barMatch(current, bar)) { if (bar && !current.bars.includes(bar)) current.bars.push(bar); return current; }
      const earlier = bar && [...blocks].reverse().find((b) => b.bars.includes(bar));
      if (earlier) return earlier;
      // A bar we haven't seen under any event (e.g. the SET UP team).
      return newBlock(SETUP.test(bar || '') ? 'Set up team' : (bar ? `${bar} bar` : 'Bar team'), r, bar, true);
    };

    const lines = [];        // non-bold Duties text: {r, text}
    let prevWasTask = false;
    for (let r = h.r + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const rowText = row.map(low).join(' ');
      if (/bar hrs|closing duties|total .*hours/.test(rowText)) break;
      const name = norm(row[h.name]);
      const duty = h.duties >= 0 ? norm(row[h.duties]) : '';
      const bar = h.bar >= 0 ? norm(row[h.bar]).toUpperCase() : '';
      const startRaw = h.start >= 0 ? row[h.start] : '';
      const start = P().toTime(startRaw);
      const person = name && !/^\d+$/.test(name);

      // Is this Duties entry an event name? Bold says so. Without formatting info, guess:
      // text that isn't a "BAR - task" line, on a row that has someone (or a spot) and a bar.
      let isEvent = false;
      if (duty) {
        const b = isBold(r);
        if (anyBoldInfo) isEvent = !!b;
        else isEvent = !CODE.test(duty) && !!bar && (person || !!start)
          && (!prevWasTask || !current || !current.bars.includes(bar));   // a new bar means a new event
      }
      if (isEvent) newBlock(duty, r, bar);
      prevWasTask = duty && !isEvent;

      if (person) {
        const status = !start && NOT_WORKING.test(norm(startRaw)) ? norm(startRaw) : '';
        if (status) { skipped.push(`${niceName(name)} (${status})`); }
        else pick(r, bar).staffDetail.push({ name: niceName(name), start, bar });
      } else if (start || isYellow(r)) {
        if (start || bar) pick(r, bar).missing.push({ start, bar });
      }
      if (duty && !isEvent) lines.push({ r, text: duty });
    }

    // Join job-list lines into tasks: a new task starts at a "BAR - …" line or after a gap.
    const tasks = [];
    for (const l of lines) {
      if (/^(duty|set\s*up)\s+notes?$/i.test(l.text)) continue;
      const prev = tasks[tasks.length - 1];
      if (prev && prev.lastRow === l.r - 1 && !CODE.test(l.text)) { prev.text += ' ' + l.text; prev.lastRow = l.r; }
      else tasks.push({ r: l.r, lastRow: l.r, text: l.text, code: (l.text.match(CODE) || [])[1] || '' });
    }
    // The event a row sits under: the one whose name appears most recently above it.
    const blockAt = (r) => {
      let best = null, at = -1;
      for (const b of blocks) for (const s0 of b.starts) if (s0 <= r && s0 > at) { best = b; at = s0; }
      return best || blocks[0];
    };
    for (const t of tasks) {
      let target = null;
      if (t.code) {
        const fits = (b) => b.bars.some((bar) => bar === t.code || t.code.startsWith(bar) || bar.startsWith(t.code));
        target = blocks.filter((b) => fits(b) && b.starts.some((s0) => s0 <= t.r)).sort((a, b) => Math.max(...b.starts.filter((s0) => s0 <= t.r)) - Math.max(...a.starts.filter((s0) => s0 <= t.r)))[0] || blocks.find(fits);
      }
      target = target || blockAt(t.r);
      if (target) target.tasks.push(t.text);
    }

    const events = blocks.filter((b) => b.staffDetail.length || b.missing.length || !b.auto).map((b) => {
      const starts = b.staffDetail.map((d) => d.start).concat(b.missing.map((m) => m.start)).filter(Boolean).sort();
      return {
        date, title: b.title, start: starts[0] || null, end: null, venue: b.bars.join(' / '), bars: b.bars, pax: '',
        notes: '', tasks: b.tasks, missing: b.missing.map((m) => Object.assign({ duty: b.title }, m)), kind: b.kind,
        staff: b.staffDetail.map((d) => d.name), staffDetail: b.staffDetail,
        manager, team: 'Bars', sheet: sheetName, fromTL: true,
      };
    });

    const shifts = [];
    events.forEach((e) => e.staffDetail.forEach((d) => shifts.push({
      date, person: d.name, start: d.start, end: null, label: '', role: d.bar ? `Bar · ${d.bar}` : 'Bar', venue: d.bar, duty: e.title,
    })));
    if (skipped.length) warnings.push(`${sheetName}: skipped ${skipped.join(', ')}.`);
    const missing = events.reduce((n, e) => n + e.missing.length, 0);
    if (missing) warnings.push(`${sheetName}: ${missing} unfilled spot${missing === 1 ? '' : 's'}.`);
    if (!events.length) warnings.push(`${sheetName}: no bar staff listed.`);
    if (!anyBoldInfo) warnings.push(`${sheetName}: couldn't read bold formatting, so event names were guessed.`);
    return { events, shifts, warnings, date };
  }

  /** If this workbook is a TL sheet, returns one ready-to-import item; otherwise null. */
  /** bold: { sheetName: Set("K6", …) } from CrownXFmt, or null if formatting couldn't be read. */
  function readTLWorkbook(wb, fileName, bold) {
    const tabs = wb.SheetNames.filter(isBarTab);
    if (!tabs.length) return null;
    const X = global.XLSX.utils;
    const all = { events: [], shifts: [], warnings: [] };
    const read = [];
    for (const sn of tabs) {
      const ws = wb.Sheets[sn];
      if (!ws || !ws['!ref']) continue;
      const rows = X.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true });
      // rows[r][c] ↔ sheet cell, offset by where the used range starts.
      const rg = X.decode_range(ws['!ref']);
      const ref = (r, c) => X.encode_cell({ r: rg.s.r + r, c: rg.s.c + c });
      const set = bold && bold[sn];
      const fmt = {
        hasBold: !!(set && set.size),
        bold: set ? (r, c) => set.has(ref(r, c)) : null,
        yellow: (r, c) => {
          const cell = ws[ref(r, c)], f = cell && cell.s && cell.s.fgColor;
          return !!(f && f.rgb && /^(FF)?FFFF00$/i.test(f.rgb));
        },
      };
      const r = readBarTab(sn, rows, fileName, fmt);
      all.events.push(...r.events); all.shifts.push(...r.shifts); all.warnings.push(...r.warnings);
      read.push(sn.trim());
    }
    const skipped = wb.SheetNames.length - tabs.length;
    return {
      label: `TL Sheet · ${read.length} bar tab${read.length === 1 ? '' : 's'} (${read.join(', ')})${skipped ? ` · ${skipped} other tabs ignored` : ''}`,
      kind: 'ready', ready: all, isTL: true,
    };
  }

  global.CrownTL = { readTLWorkbook, niceName, isBarTab };
})(window);
