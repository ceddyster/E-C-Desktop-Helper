/* Reader for the Crown "TL" workbook (e.g. "TL 26.10.2026-1.11.2026.xlsx").
 *
 * The workbook has one tab per day and team: MON- GB (1), MON-BAR, FRI-BAR (1), ...
 * Only the BAR tabs are read. Each BAR tab looks like:
 *
 *   B1 "BARS"                                  K1 "Monday, October 26, 2026"
 *   B3 "MANAGER"   C3 "Cedric"
 *   row 5: Name | ID | Start | 1/2 | 1st 15 | 2nd 15 | Finish | Hours | Bar | Duties
 *   rows 6+: one staff member per row. Bar = which bar (STUDIO, AST, CB2...),
 *            Duties = the event they're working. Rows with only Duties text are notes
 *            ("DUTY NOTES", "STUDIO - COMPLETE CLEAN & CLEAR").
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

  function readBarTab(sheetName, rows, fileName) {
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
    if (!date) {
      const ws = weekStartFromName(fileName), dm = sheetName.toUpperCase().match(/\b(MON|TUE|WED|THU|FRI|SAT|SUN)/), day = dm ? DAYS.indexOf(dm[1]) : -1;
      if (ws && day >= 0) { ws.setDate(ws.getDate() + day); date = P().isoOf(ws); }
    }
    if (!date) return { events: [], shifts: [], warnings: [`${sheetName}: couldn't work out the date.`] };

    const staff = [];        // {name, start, bar, duty, status}
    const notes = [];        // free text rows in Duties
    for (let r = h.r + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const rowText = row.map(low).join(' ');
      if (/bar hrs|closing duties|total .*hours/.test(rowText)) break;
      const name = norm(row[h.name]);
      const duty = h.duties >= 0 ? norm(row[h.duties]) : '';
      const bar = h.bar >= 0 ? norm(row[h.bar]).toUpperCase() : '';
      const startRaw = h.start >= 0 ? row[h.start] : '';
      if (name && !/^\d+$/.test(name)) {
        const start = P().toTime(startRaw);
        const status = !start && NOT_WORKING.test(norm(startRaw)) ? norm(startRaw) : '';
        staff.push({ name: niceName(name), start, bar, duty, status });
      } else if (duty) {
        notes.push({ text: duty, bar });
      } else if (bar && staff.length) {
        // Bar filled but no name (e.g. TBC slot) – keep the bar in play for following notes.
      }
    }

    // Group staff into events. A row with a Bar but no Duties belongs to the last event at that bar.
    const events = [];
    const byKey = new Map();
    const lastDutyAtBar = {};
    let lastDuty = '';
    for (const s of staff) {
      if (s.status) continue;
      let duty = s.duty || (s.bar && lastDutyAtBar[s.bar]) || '';
      if (!duty) duty = lastDuty;      // blank Duties = same event as the row above
      if (!duty) duty = s.bar ? `${s.bar} bar` : 'Bar shift';
      if (s.bar) lastDutyAtBar[s.bar] = duty;
      lastDuty = duty;
      const key = duty.toLowerCase();
      let ev = byKey.get(key);
      if (!ev) {
        ev = { date, title: duty, start: null, end: null, venue: '', bars: [], pax: '', notes: '', staff: [], staffDetail: [], manager, team: 'Bars', sheet: sheetName, fromTL: true };
        byKey.set(key, ev); events.push(ev);
      }
      if (s.bar && !ev.bars.includes(s.bar)) ev.bars.push(s.bar);
      if (s.start && (!ev.start || s.start < ev.start)) ev.start = s.start;
      ev.staff.push(s.name);
      ev.staffDetail.push({ name: s.name, start: s.start, bar: s.bar });
    }
    events.forEach((e) => { e.venue = e.bars.join(' / '); });

    // Attach notes: a line starting with a bar code ("AST - CLEAN & RESET…") goes to that bar's event;
    // lines that don't start with a bar code continue the previous note.
    const noteGroups = [];
    for (const n of notes) {
      if (/^duty notes?$/i.test(n.text)) continue;
      const lead = n.text.split(/\s*[-–:]\s*/)[0].toUpperCase();
      const known = events.some((e) => e.bars.includes(lead));
      if (known || !noteGroups.length) noteGroups.push({ bar: known ? lead : '', text: n.text });
      else noteGroups[noteGroups.length - 1].text += ' ' + n.text;
    }
    const dayNotes = [];
    for (const g of noteGroups) {
      const ev = g.bar && events.find((e) => e.bars.includes(g.bar));
      if (ev) ev.notes = ev.notes ? `${ev.notes} · ${g.text}` : g.text;
      else dayNotes.push(g.text);
    }
    if (dayNotes.length && events.length) {
      events[0].notes = [events[0].notes, ...dayNotes].filter(Boolean).join(' · ');
    }

    const shifts = [];
    events.forEach((e) => e.staffDetail.forEach((d) => shifts.push({
      date, person: d.name, start: d.start, end: null, label: '', role: d.bar ? `Bar · ${d.bar}` : 'Bar', venue: d.bar, duty: e.title,
    })));
    const out = staff.filter((s) => s.status);
    if (out.length) warnings.push(`${sheetName}: skipped ${out.map((s) => `${s.name} (${s.status})`).join(', ')}.`);
    if (!events.length) warnings.push(`${sheetName}: no bar staff listed.`);
    return { events, shifts, warnings, date };
  }

  /** If this workbook is a TL sheet, returns one ready-to-import item; otherwise null. */
  function readTLWorkbook(wb, fileName) {
    const tabs = wb.SheetNames.filter(isBarTab);
    if (!tabs.length) return null;
    const all = { events: [], shifts: [], warnings: [] };
    const read = [];
    for (const sn of tabs) {
      const rows = global.XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: '', blankrows: true });
      const r = readBarTab(sn, rows, fileName);
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
