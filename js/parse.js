/* Turns spreadsheets, CSVs and .ics files into dashboard events and shifts.
 * Everything runs in the browser; nothing is uploaded anywhere. */
(function (global) {
  'use strict';

  const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const OFF_CODES = /^(off|rdo|al|a\/l|sl|s\/l|lsl|lwop|leave|ph|x|-|–|n\/a|na|req off|avail|unavail|nil)$/i;

  const pad = (n) => String(n).padStart(2, '0');
  const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  /* ---------- Dates ---------- */

  // Year-less dates (e.g. "Mon 3/11") get the year that puts them closest to today.
  function withBestYear(month, day) {
    const now = new Date();
    let best = null;
    for (const y of [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]) {
      const d = new Date(y, month, day);
      if (d.getMonth() !== month) continue;
      if (!best || Math.abs(d - now) < Math.abs(best - now)) best = d;
    }
    return best;
  }

  function excelSerialToDate(n) {
    // Excel day 25569 = 1970-01-01. Read as local calendar date.
    const ms = Math.round((n - 25569) * 86400000);
    const u = new Date(ms);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes());
  }

  /** Returns 'YYYY-MM-DD' or null. Australian day-first order for numeric dates. */
  function toISODate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date && !isNaN(v)) {
      // SheetJS can return dates a few seconds off midnight; round to nearest minute.
      const d = new Date(Math.round(v.getTime() / 60000) * 60000);
      return isoOf(d);
    }
    if (typeof v === 'number') {
      if (v > 20000 && v < 80000) return isoOf(excelSerialToDate(v));
      return null;
    }
    const s = String(v).trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1');
    let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return isoOf(new Date(+m[1], +m[2] - 1, +m[3]));
    if ((m = s.match(/(?:^|\s)(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?(?:\s|$)/))) {
      const day = +m[1], mon = +m[2] - 1;
      if (mon > 11 || day > 31 || day < 1) return null;
      if (m[3]) {
        let y = +m[3]; if (y < 100) y += 2000;
        return isoOf(new Date(y, mon, day));
      }
      const d = withBestYear(mon, day); return d ? isoOf(d) : null;
    }
    // "3 nov 2026", "mon 3 november", "nov 3, 2026"
    const monIdx = (w) => MONTHS.indexOf(w.slice(0, 3));
    if ((m = s.match(/(\d{1,2})\s+([a-z]{3,9})\.?,?(?:\s+(\d{4}))?/)) && monIdx(m[2]) >= 0) {
      const mon = monIdx(m[2]);
      if (m[3]) return isoOf(new Date(+m[3], mon, +m[1]));
      const d = withBestYear(mon, +m[1]); return d ? isoOf(d) : null;
    }
    if ((m = s.match(/([a-z]{3,9})\.?\s+(\d{1,2}),?(?:\s+(\d{4}))?/)) && monIdx(m[1]) >= 0) {
      const mon = monIdx(m[1]);
      if (m[3]) return isoOf(new Date(+m[3], mon, +m[2]));
      const d = withBestYear(mon, +m[2]); return d ? isoOf(d) : null;
    }
    return null;
  }

  /* ---------- Times ---------- */

  function fmtHM(h, mi) {
    if (h > 24 || mi > 59) return null;
    return `${pad(h % 24)}:${pad(mi)}`;
  }

  /** Returns 'HH:MM' (24h) or null. */
  function toTime(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date && !isNaN(v)) {
      const d = new Date(Math.round(v.getTime() / 60000) * 60000);
      return fmtHM(d.getHours(), d.getMinutes());
    }
    if (typeof v === 'number') {
      if (v >= 0 && v < 1) { const mins = Math.round(v * 1440); return fmtHM(Math.floor(mins / 60), mins % 60); }
      if (v > 20000 && v < 80000) { const frac = v % 1; return frac ? toTime(frac) : null; }
      if (Number.isInteger(v) && v >= 0 && v <= 2400) return fmtHM(Math.floor(v / 100), v % 100);
      return null;
    }
    const s = String(v).trim().toLowerCase().replace(/\./g, ':');
    let m;
    if ((m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)$/))) {
      let h = +m[1] % 12; if (m[3][0] === 'p') h += 12;
      return fmtHM(h, +(m[2] || 0));
    }
    if ((m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/))) return fmtHM(+m[1], +m[2]);
    if ((m = s.match(/^(\d{3,4})(?:\s*h(?:rs)?)?$/))) { const n = +m[1]; return fmtHM(Math.floor(n / 100), n % 100); }
    if (s === 'noon') return '12:00';
    if (s === 'midnight') return '00:00';
    return null;
  }

  /** "07:00-15:00", "7am - 3pm", "0700 to 1500" → {start, end} */
  function parseRange(v) {
    if (v == null) return null;
    const s = String(v).trim();
    const parts = s.split(/\s*(?:-|–|—|\bto\b|\btill\b|\buntil\b)\s*/i).filter(Boolean);
    if (parts.length < 2) return null;
    let a = parts[0], b = parts[1];
    // "6-11pm" → borrow the meridiem from the end time.
    const mer = b.match(/(am|pm|a|p)$/i);
    if (mer && !/(am|pm|a|p)$/i.test(a) && /^\d{1,2}(:\d{2})?$/.test(a)) a += mer[1];
    const start = toTime(a), end = toTime(b.replace(/\s*(finish|close|late)$/i, ''));
    if (!start) return null;
    return { start, end };
  }

  /* ---------- Column guessing ---------- */

  const FIELDS = [
    ['date',   /\b(date|day)\b/],
    ['staff',  /\b(staff|manager|mgr|supervisor|assigned|working|lead|tl|team leader|coordinator|captain|host|on duty|duty|ops|team)\b/],
    ['start',  /\b(start|from|begin|commence|time in|arrival|arrive|doors)\b/],
    ['end',    /\b(end|finish|until|time out|close|conclude|depart)\b/],
    ['venue',  /\b(venue|room|location|space|area|outlet|level|floor|ballroom)\b/],
    ['pax',    /\b(pax|guests|covers|attendees|numbers|guest count|attendance)\b/],
    ['notes',  /\b(notes?|comments?|remarks?|details|info|requirements)\b/],
    ['role',   /\b(role|position|dept|department|job|designation)\b/],
    ['title',  /\b(event|function|title|client|booking|description|occasion|name of|organisation|organization|company|account)\b/],
    ['person', /\b(name|employee|team member|person|who|associate)\b/],
    ['time',   /\b(time|times|hours|shift|roster)\b/],
  ];
  const FIELD_NAMES = FIELDS.map((f) => f[0]).concat(['staff2']);

  function norm(h) { return String(h == null ? '' : h).toLowerCase().replace(/[_#:*()]/g, ' ').replace(/\s+/g, ' ').trim(); }

  function guessMapping(headers) {
    const map = {};
    headers.forEach((h, i) => {
      const n = norm(h);
      if (!n) return;
      for (const [field, re] of FIELDS) {
        if (!re.test(n)) continue;
        if (map[field] == null) { map[field] = i; return; }
        if (field === 'staff' && map.staff2 == null) { map.staff2 = i; return; }
      }
    });
    // A combined "time" column acts as the start column (ranges are split later).
    if (map.start == null && map.time != null) { map.start = map.time; }
    delete map.time;
    return map;
  }

  function dateHeaderCols(headers) {
    const cols = [];
    headers.forEach((h, i) => { if (toISODate(h)) cols.push(i); });
    return cols;
  }

  function findHeaderRow(rows) {
    let best = 0, bestScore = -1;
    for (let i = 0; i < Math.min(rows.length, 25); i++) {
      const row = rows[i] || [];
      let score = 0;
      for (const cell of row) {
        if (typeof cell !== 'string') continue;
        const n = norm(cell);
        if (n && n.length < 40 && FIELDS.some(([, re]) => re.test(n))) score++;
      }
      const dates = dateHeaderCols(row).length;
      if (dates >= 3) score = Math.max(score, dates);
      if (score > bestScore) { best = i; bestScore = score; }
    }
    return best;
  }

  /* ---------- Sheet analysis ---------- */

  function analyseRows(rows, label, fileName) {
    rows = rows.filter((r) => r && r.some((c) => c !== '' && c != null));
    const headerIdx = findHeaderRow(rows);
    const headers = (rows[headerIdx] || []).map((h) => (h instanceof Date ? isoOf(h) : String(h == null ? '' : h).trim()));
    const mapping = guessMapping(headers);
    const dateCols = dateHeaderCols(rows[headerIdx] || []);
    let kind;
    if (dateCols.length >= 3) kind = 'grid';
    else if (mapping.title != null) kind = 'events';
    else if ((mapping.person != null || mapping.staff != null) && mapping.date != null) kind = 'roster';
    else if (mapping.date != null) kind = 'events';
    else kind = 'skip';
    if (kind === 'grid' && mapping.person == null) {
      mapping.person = mapping.staff != null ? mapping.staff : headers.findIndex((_, i) => !dateCols.includes(i));
    }
    // Day sheets often have no Date column: the date sits in a title row, the tab name or the file name.
    let contextDate = null;
    for (let i = 0; i < headerIdx && !contextDate; i++) for (const c of rows[i]) { if ((contextDate = toISODate(c))) break; }
    contextDate = contextDate || toISODate(label) || toISODate(String(fileName || '').replace(/\.[a-z0-9]+$/i, ''));
    if (kind === 'skip' && contextDate && (mapping.title != null || mapping.venue != null)) kind = 'events';
    return { label, rows, headerIdx, headers, mapping, kind, dateCols, contextDate };
  }

  const cell = (row, i) => (i == null || i < 0 ? '' : row[i]);
  const text = (v) => (v == null ? '' : v instanceof Date ? isoOf(v) : String(v).trim());
  const splitPeople = (s) => text(s).split(/\s*(?:,|;|\/|&|\+|\n|\band\b)\s*/i).map((x) => x.trim()).filter((x) => x && !/^(tbc|tba|n\/a|-)$/i.test(x));

  /** Converts an analysed sheet into {events, shifts, warnings}. */
  function build(sheet) {
    const { rows, headerIdx, mapping: m, kind } = sheet;
    const out = { events: [], shifts: [], warnings: [] };
    const body = rows.slice(headerIdx + 1);

    if (kind === 'events') {
      let lastDate = null;
      for (const row of body) {
        const date = toISODate(cell(row, m.date)) || null;
        if (date) lastDate = date;
        const title = text(cell(row, m.title));
        if (!title) continue;
        const d = date || lastDate || sheet.contextDate;  // dates are often only on the first row of a block
        if (!d) continue;
        let start = toTime(cell(row, m.start)), end = toTime(cell(row, m.end));
        if (!start) { const r = parseRange(cell(row, m.start)); if (r) { start = r.start; end = end || r.end; } }
        if (!start && m.date != null) start = toTime(cell(row, m.date)); // date+time in one cell
        const staff = [...splitPeople(cell(row, m.staff)), ...splitPeople(cell(row, m.staff2))];
        out.events.push({
          date: d, start, end, title,
          venue: text(cell(row, m.venue)), pax: text(cell(row, m.pax)),
          notes: text(cell(row, m.notes)), staff,
        });
      }
    } else if (kind === 'roster') {
      const who = m.person != null ? m.person : m.staff;
      let lastDate = null;
      for (const row of body) {
        const date = toISODate(cell(row, m.date)); if (date) lastDate = date;
        const person = text(cell(row, who));
        if (!person || !(date || lastDate || sheet.contextDate)) continue;
        let start = toTime(cell(row, m.start)), end = toTime(cell(row, m.end)), label = '';
        if (!start) {
          const raw = text(cell(row, m.start));
          const r = parseRange(raw);
          if (r) { start = r.start; end = end || r.end; }
          else if (raw && OFF_CODES.test(raw)) continue;
          else label = raw;
        }
        out.shifts.push({ date: date || lastDate || sheet.contextDate, person, start, end, label, role: text(cell(row, m.role)), venue: text(cell(row, m.venue)) });
      }
    } else if (kind === 'grid') {
      const header = rows[headerIdx];
      const dateCols = sheet.dateCols;
      for (const row of body) {
        const person = text(cell(row, m.person));
        if (!person || toISODate(person)) continue;
        for (const ci of dateCols) {
          const raw = row[ci];
          const s = text(raw);
          if (!s || OFF_CODES.test(s)) continue;
          const date = toISODate(header[ci]);
          const r = parseRange(s);
          out.shifts.push({
            date, person,
            start: r ? r.start : null, end: r ? r.end : null, label: r ? '' : s,
            role: text(cell(row, m.role)), venue: '',
          });
        }
      }
    }
    if (kind !== 'skip' && !out.events.length && !out.shifts.length) out.warnings.push('Nothing could be read with these settings — check the column choices.');
    return out;
  }

  /* ---------- Files ---------- */

  async function readSpreadsheet(name, buf) {
    if (!global.XLSX) throw new Error('Spreadsheet library failed to load.');
    // CSVs are read as plain text so "3/11/2026" stays day-first (SheetJS would read it as US m/d).
    const isText = /\.(csv|tsv|txt)$/i.test(name);
    const wb = global.XLSX.read(buf, isText ? { type: 'array', raw: true } : { type: 'array', cellDates: true });
    return wb.SheetNames.map((sn) => {
      const rows = global.XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: '', blankrows: false });
      return analyseRows(rows, wb.SheetNames.length > 1 ? sn : '', name);
    });
  }

  function unfoldIcs(txt) { return txt.replace(/\r?\n[ \t]/g, '').split(/\r?\n/); }
  function icsUnescape(s) { return (s || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1'); }
  function icsDate(val, params) {
    const m = val.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
    if (!m) return { date: null, time: null };
    if (!m[4] || /VALUE=DATE(?!-)/.test(params)) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: null };
    let d = m[7]
      ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]))
      : new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);   // floating / TZID → treat as local
    return { date: isoOf(d), time: fmtHM(d.getHours(), d.getMinutes()) };
  }

  function parseIcs(txt) {
    const events = [];
    let cur = null;
    for (const line of unfoldIcs(txt)) {
      if (line === 'BEGIN:VEVENT') { cur = { staff: [] }; continue; }
      if (line === 'END:VEVENT') {
        if (cur && cur.date) events.push({ date: cur.date, start: cur.start, end: cur.end, title: cur.title || '(untitled)', venue: cur.venue || '', notes: cur.notes || '', pax: '', staff: cur.staff });
        cur = null; continue;
      }
      if (!cur) continue;
      const idx = line.indexOf(':'); if (idx < 0) continue;
      const left = line.slice(0, idx), val = line.slice(idx + 1);
      const [key, ...params] = left.split(';');
      const p = params.join(';');
      if (key === 'DTSTART') { const r = icsDate(val, p); cur.date = r.date; cur.start = r.time; }
      else if (key === 'DTEND') { cur.end = icsDate(val, p).time; }
      else if (key === 'SUMMARY') cur.title = icsUnescape(val);
      else if (key === 'LOCATION') cur.venue = icsUnescape(val);
      else if (key === 'DESCRIPTION') cur.notes = icsUnescape(val).slice(0, 500);
      else if (key === 'ATTENDEE') { const cn = p.match(/CN="?([^";]+)"?/); if (cn) cur.staff.push(cn[1]); }
    }
    return events;
  }

  /** Reads one file → [{label, kind, ...sheet}] or a ready result for ics/json. */
  async function readFile(name, buf) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (ext === 'url' || ext === 'website') {
      // Windows internet shortcut: [InternetShortcut] URL=https://...
      const m = new TextDecoder().decode(buf).match(/^URL=(https:\/\/\S+)/mi);
      if (!m) throw new Error('No web address found in this shortcut.');
      return [{ label: '', kind: 'link', url: m[1].trim() }];
    }
    if (ext === 'ics') {
      const events = parseIcs(new TextDecoder().decode(buf));
      return [{ label: '', kind: 'ready', ready: { events, shifts: [], warnings: events.length ? [] : ['No events found in this calendar file.'] } }];
    }
    if (ext === 'json') {
      const data = JSON.parse(new TextDecoder().decode(buf));
      return [{ label: '', kind: 'ready', ready: { events: data.events || [], shifts: data.shifts || [], warnings: [] } }];
    }
    return readSpreadsheet(name, buf);
  }

  global.CrownParse = { readFile, analyseRows, build, toISODate, toTime, parseRange, parseIcs, FIELD_NAMES, isoOf };
})(window);
