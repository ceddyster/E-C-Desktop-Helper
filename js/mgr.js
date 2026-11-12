/* Manager allocation workbook reader ("Managers Allocation 09.11.26 - 15.11.26.xlsx").
 *
 * Layout (one sheet, "Manager's Roster"):
 *   A1           title, "Events & Conferences Manager Allocation"
 *   row 2        Monday … Sunday across B:H
 *   row 3        the dates (B3 = Monday, then =B3+1 …)
 *   then per manager:
 *     name row   A = name, B:H = start time (900, 1630, "900 - 1700") or RDO / AL
 *     role row   A = role ("BSM", "Asst Ops Mgr"); B:H may already hold an event
 *     more rows  B:H = events / duties for that day ("PWC", "Setup", "Duty Manager"), until the next name row
 *   Section headings ("SERVICE", "HIGH DUTIES", "ADMINISTRATION") sit on their own in column A.
 */
(function (global) {
  'use strict';
  const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const OFF = /^(rdo|al|a\/l|lsl|sl|s\/l|sick|off|leave|annual leave|ph|public holiday|lwop|n\/a|-|–)$/i;
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  function grid(ws) {
    const X = global.XLSX;
    const r = X.utils.decode_range(ws['!ref']);
    const cell = (R, C) => ws[X.utils.encode_cell({ r: R, c: C })];
    const val = (R, C) => { const c = cell(R, C); return c ? c.v : undefined; };
    const str = (R, C) => { const v = val(R, C); return v == null ? '' : v instanceof Date ? '' : String(v).replace(/ /g, ' ').trim(); };
    return { r, val, str };
  }

  /** The row with Monday…Sunday across it: { row, cols: [7 column numbers] } or null. */
  function header(g) {
    for (let R = g.r.s.r; R <= Math.min(g.r.e.r, g.r.s.r + 15); R++) {
      const cols = [];
      for (let C = g.r.s.c; C <= g.r.e.c; C++) {
        const i = DAYS.indexOf(g.str(R, C).toLowerCase());
        if (i >= 0 && cols[i] == null) cols[i] = C;
      }
      if (cols.filter((c) => c != null).length >= 5) return { row: R, cols };
    }
    return null;
  }

  function looksLike(wb) {
    for (const sn of wb.SheetNames) {
      const ws = wb.Sheets[sn]; if (!ws || !ws['!ref']) continue;
      const g = grid(ws);
      const title = [0, 1, 2].map((R) => g.str(R, 0)).join(' ');
      if (/manager'?s?\s*(allocation|roster)/i.test(title + ' ' + sn) && header(g)) return true;
    }
    return false;
  }

  // "900" → 09:00 · "1630" → 16:30 · "900 - 1700" → 09:00–17:00 · Excel time fractions too.
  function shiftOf(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number' && v > 0 && v < 1) { const m = Math.round(v * 1440); return { start: `${pad(Math.floor(m / 60))}:${pad(m % 60)}` }; }
    const s = String(v).replace(/ /g, ' ').trim();
    if (OFF.test(s)) return { off: s.toUpperCase() };
    const t = (x) => {
      const m = String(x).trim().toLowerCase().replace(/\./g, ':').match(/^(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?$/);
      if (!m) return null;
      let h = +m[1], mi = m[2] != null ? +m[2] : 0;
      if (m[2] == null && m[1].length >= 3) { h = Math.floor(+m[1] / 100); mi = +m[1] % 100; }
      const raw = String(x).trim();
      if (/^\d{3,4}$/.test(raw)) { h = Math.floor(+raw / 100); mi = +raw % 100; }
      if (m[3] === 'pm' && h < 12) h += 12;
      if (m[3] === 'am' && h === 12) h = 0;
      return h <= 24 && mi < 60 ? `${pad(h)}:${pad(mi)}` : null;
    };
    const parts = s.split(/\s*(?:-|–|—|\bto\b)\s*/i).filter(Boolean);
    if (parts.length === 2 && t(parts[0]) && t(parts[1])) return { start: t(parts[0]), end: t(parts[1]) };
    if (parts.length === 1 && t(parts[0])) return { start: t(parts[0]) };
    return null;
  }

  /** The week's seven dates, from the date row, else the file name ("09.11.26 - 15.11.26"). */
  function dates(g, h, fileName) {
    const out = [];
    for (let R = h.row - 1; R <= h.row + 2 && !out.length; R++) {
      const first = h.cols.map((C) => g.val(R, C)).find((v) => v instanceof Date || (typeof v === 'number' && v > 30000 && v < 80000));
      if (!first) continue;
      const i = h.cols.findIndex((C) => g.val(R, C) === first);
      const d0 = first instanceof Date ? new Date(first.getFullYear(), first.getMonth(), first.getDate() + (first.getHours() >= 12 ? 1 : 0))
        : new Date(Math.round((first - 25569) * 864e5) + new Date().getTimezoneOffset() * 6e4);
      const mon = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() - i);
      for (let k = 0; k < 7; k++) out.push(iso(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + k)));
    }
    if (!out.length) {
      const m = String(fileName || '').match(/(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{2,4})/);
      if (m) {
        const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
        const d = new Date(y, +m[2] - 1, +m[1]);
        const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
        for (let k = 0; k < 7; k++) out.push(iso(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + k)));
      }
    }
    return out;
  }

  /** → { weekStart, dates: [7 ISO dates], people: [{ name, role, section, days: { iso: { start, end, off, text, events: [] } } }] } */
  function read(wb, fileName) {
    const warnings = [];
    for (const sn of wb.SheetNames) {
      const ws = wb.Sheets[sn]; if (!ws || !ws['!ref']) continue;
      const g = grid(ws);
      const h = header(g);
      if (!h) continue;
      const ds = dates(g, h, fileName);
      if (ds.length !== 7) { warnings.push('Couldn\'t find the week\'s dates.'); continue; }
      const nameCol = Math.max(g.r.s.c, Math.min(...h.cols.filter((c) => c != null)) - 1);
      const dayCells = (R) => h.cols.map((C) => (C == null ? undefined : g.val(R, C)));
      // A row is a manager's row when at least one day holds a time or RDO / AL.
      const isShiftRow = (R) => dayCells(R).some((v) => shiftOf(v));
      // Section headings ("SERVICE", "ADMINISTRATION") are merged across the sheet.
      const merged = (ws['!merges'] || []).filter((m) => m.s.c === nameCol && m.e.c - m.s.c >= 3 && m.s.r === m.e.r).map((m) => m.s.r);
      const people = [];
      let section = '', cur = null;
      for (let R = h.row + 1; R <= g.r.e.r; R++) {
        const a = g.str(R, nameCol);
        const cells = dayCells(R);
        if (merged.includes(R)) { section = a.replace(/\s+/g, ' ').trim(); cur = null; continue; }
        if (isShiftRow(R)) {
          cur = { name: a, role: '', section, days: {}, roleRow: R + 1 };
          cells.forEach((v, i) => {
            const sh = shiftOf(v);
            const text = v == null || v instanceof Date ? '' : String(v).trim();
            cur.days[ds[i]] = Object.assign({ events: [] }, sh || (text ? { text } : { blank: true }));
          });
          people.push(cur);
          continue;
        }
        if (!cur) continue;
        if (a) {
          if (R === cur.roleRow) cur.role = a;       // the line under the name is the role
          else { cur = null; continue; }             // a name with no times ("TBC"): not part of the manager above
        }
        cells.forEach((v, i) => {
          if (v == null || v instanceof Date) return;
          const t = String(v).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
          if (t && !shiftOf(t)) cur.days[ds[i]].events.push(t);
        });
      }
      // Rows with no name and no one working (an empty template line on RDO) aren't anybody.
      const kept = people.filter((p) => p.name || Object.values(p.days).some((d) => d.start || d.text || d.events.length))
        .map((p) => ({ name: p.name.replace(/\s+/g, ' ').trim(), role: p.role.replace(/\s+/g, ' ').trim(), section: p.section, days: p.days }));
      if (!kept.length) { warnings.push('No managers found.'); continue; }
      return { weekStart: ds[0], dates: ds, people: kept, sheet: sn, warnings };
    }
    throw new Error(`couldn't read the manager allocation (${warnings.join(' ') || 'no Monday–Sunday header row found'}).`);
  }

  global.CrownMgr = { looksLike, read, shiftOf };
})(window);
