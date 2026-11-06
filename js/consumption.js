/* Banquet consumption workbooks (e.g. "04.xlsm" for the 4th of the month).
 *
 * Each event tab holds:
 *   A1:F7   event details: BEO #, Date, Event Name, Pax, Room, Event Manager, Service Manager, DM, Event Type
 *   O…Z, AB…AM, AO…AZ, BB…BM   up to four bar blocks ("Banquet Consumption Report" | <bar name>)
 *   BO…BZ   the Total block, with on-consumption revenue, package revenue, beverage cost and cost %
 * Every block lists products under category headings (Crown Reserve, Beer, Soft Drinks …) with
 * Size | Opening | Transfer | Closing | Used | Charge inc GST | Charge ex GST | Total charge | Unit cost | Total cost.
 *
 * Product rows are taken from the bar blocks (so totals can be split by bar); event revenue and
 * cost come from the Total block, which is what the workbook's own Summary uses.
 * Data is kept in IndexedDB (it can grow over a year), one record per workbook day.
 */
(function (global) {
  'use strict';
  const MARK = 'banquet consumption report';

  /* ---------- Reading ---------- */

  function cellReader(ws) {
    const X = global.XLSX.utils;
    const at = (r, c) => ws[X.encode_cell({ r: r - 1, c: c - 1 })];
    return {
      num: (r, c) => { const x = at(r, c); return x && x.t === 'n' && isFinite(x.v) ? x.v : null; },
      str: (r, c) => { const x = at(r, c); return x && (x.t === 's' || x.t === 'str') ? String(x.v).trim() : ''; },
      date: (r, c) => { const x = at(r, c); return x && x.t === 'd' ? x.v : x && x.t === 'n' && x.v > 20000 && x.v < 80000 ? new Date(Math.round((x.v - 25569) * 864e5)) : null; },
      any: (r, c) => { const x = at(r, c); return x && x.t !== 'e' ? x.v : null; },
      maxC: X.decode_range(ws['!ref'] || 'A1').e.c + 1,
    };
  }
  const iso = (d) => (d ? global.CrownParse.toISODate(d) || '' : '');

  /** True if the workbook looks like a consumption workbook (checks row 1 of each tab). */
  function isConsumptionWorkbook(wb) {
    return wb.SheetNames.some((sn) => {
      const ws = wb.Sheets[sn]; if (!ws || !ws['!ref']) return false;
      const c = cellReader(ws);
      for (let col = 1; col <= Math.min(c.maxC, 80); col++) if (c.str(1, col).toLowerCase() === MARK) return true;
      return false;
    });
  }

  /** Label → value to its right, searched in the event-details area (rows 1-8, before the first block). */
  function details(c, lastCol) {
    const out = {};
    const want = { 'beo #': 'beo', 'beo': 'beo', 'date': 'date', 'event name': 'event', 'pax': 'pax', 'room': 'room',
      'event manager': 'em', 'service manager': 'sm', 'dm': 'dm', 'event type': 'type', 'sales': 'sales', 'chef': 'chef' };
    for (let r = 1; r <= 8; r++) {
      for (let col = 1; col < lastCol; col++) {
        const key = want[c.str(r, col).toLowerCase().replace(/\s+/g, ' ').replace(/:$/, '')];
        if (!key || out[key] != null) continue;
        for (let k = col + 1; k < Math.min(col + 4, lastCol); k++) {
          const v = key === 'date' ? c.date(r, k) : c.any(r, k);
          if (v != null && v !== '' && v !== 0) { out[key] = v; break; }
        }
      }
    }
    return out;
  }

  function readBlock(c, col) {
    // Header row: the one with "Used" in the Used column (normally row 12).
    let hr = 0;
    for (let r = 9; r <= 16 && !hr; r++) if (/^used$/i.test(c.str(r, col + 6))) hr = r;
    if (!hr) return [];
    const rows = [];
    let cat = '';
    for (let r = hr + 1; r <= hr + 120; r++) {
      const name = c.str(r, col);
      if (!name) continue;
      const sizeTxt = c.str(r, col + 2);
      const used = c.num(r, col + 6), opening = c.num(r, col + 3), closing = c.num(r, col + 5);
      // Category heading: text with no numbers beside it (or a repeated header like "A la Carte Stock | Size").
      if (sizeTxt || (used == null && opening == null && closing == null && c.num(r, col + 7) == null)) {
        cat = /a la carte/i.test(name) ? 'A la Carte' : name.replace(/\s+/g, ' ').trim();
        continue;
      }
      const totalCharge = c.num(r, col + 9) || 0, totalCost = c.num(r, col + 11) || 0;
      if (!used && !totalCharge && !totalCost) continue;      // only what was actually used
      rows.push({
        cat, prod: name.replace(/\s+/g, ' ').trim(), size: c.num(r, col + 2) || '',
        open: opening || 0, xfer: c.num(r, col + 4) || 0, close: closing || 0, used: used || 0,
        unit: c.num(r, col + 7) || 0, chg: totalCharge, cost: totalCost,
      });
    }
    return rows;
  }

  /** Revenue / cost figures from the Total block's header area. */
  function totals(c, col) {
    const right = (label) => {
      for (let r = 1; r <= 10; r++) for (let k = col; k <= col + 11; k++) if (c.str(r, k).toLowerCase().replace(/\s+/g, ' ') === label) return c.num(r, k + 1);
      return null;
    };
    const below = (label) => {
      for (let r = 1; r <= 10; r++) for (let k = col; k <= col + 11; k++) if (c.str(r, k).toLowerCase().replace(/\s+/g, ' ').trim() === label) return c.num(r + 1, k);
      return null;
    };
    return {
      onCons: right('on consumption revenue'), pkgRev: right('package price revenue'), revenue: right('total beverage revenue'),
      perHead: right('dollars per head'), cost: below('cost'), costPct: below('cost %'),
    };
  }

  /** Parses a consumption workbook → { date, events: [...], rows: [...] }. */
  function read(wb, fileName) {
    const events = [], rows = [], warnings = [];
    let wbDate = '';
    for (const sn of wb.SheetNames) {
      const ws = wb.Sheets[sn]; if (!ws || !ws['!ref']) continue;
      const c = cellReader(ws);
      if (/^summary$/i.test(sn.trim())) { const d = c.date(1, 1); if (d) wbDate = iso(d); continue; }
      const blocks = [];
      for (let col = 1; col <= c.maxC; col++) if (c.str(1, col).toLowerCase() === MARK) blocks.push(col);
      if (!blocks.length) continue;
      const d = details(c, blocks[0]);
      const totalCol = blocks.find((col) => /^total$/i.test(c.str(1, col + 1)));
      const barCols = blocks.filter((col) => col !== totalCol);
      const date = d.date ? iso(d.date) : '';
      const ev = {
        tab: sn, date, beo: d.beo ? String(d.beo) : '', event: d.event ? String(d.event).trim() : sn.trim(), pax: +d.pax || 0,
        room: d.room ? String(d.room).trim() : '', type: d.type ? String(d.type).trim() : '', em: d.em ? String(d.em).trim() : '',
        sm: d.sm ? String(d.sm).trim() : '', dm: d.dm ? String(d.dm).trim() : '', bars: [],
      };
      let evRows = [];
      barCols.forEach((col, i) => {
        // Bar name: "Bar Name / Location" (row 8), else the title next to "Banquet Consumption Report".
        let bar = '';
        for (let r = 1; r <= 9; r++) if (/bar name/i.test(c.str(r, col))) bar = String(c.any(r, col + 1) || '').trim();
        if (!bar || bar === '0') bar = String(c.any(1, col + 1) || '').trim();
        if (!bar || bar === '0') bar = `Bar ${i + 1}`;
        bar = bar.replace(/^(cb|gb|ast|bot|stu)(\d)/i, (m) => m.toUpperCase());
        const br = readBlock(c, col);
        if (br.length) ev.bars.push(bar);
        br.forEach((x) => { x.bar = bar; });
        evRows = evRows.concat(br);
      });
      // No bar blocks filled in, but the Total block has figures: use it.
      if (!evRows.length && totalCol) evRows = readBlock(c, totalCol).map((x) => Object.assign(x, { bar: 'Total' }));
      // Cross-check: the bar blocks should add up to the Total block (the workbook sums them itself).
      // A difference means something was filled in somewhere we didn't read.
      if (totalCol && evRows.length && evRows[0].bar !== 'Total') {
        const tUnits = readBlock(c, totalCol).reduce((s, x) => s + x.used, 0);
        const bUnits = evRows.reduce((s, x) => s + x.used, 0);
        if (Math.abs(tUnits - bUnits) > 0.5) warnings.push(`${sn.trim()}: the bar sections add up to ${Math.round(bUnits)} units but the Total section says ${Math.round(tUnits)}. Something may be filled in outside the usual layout.`);
      }
      const t = totalCol ? totals(c, totalCol) : {};
      Object.assign(ev, {
        revenue: t.revenue || t.pkgRev || 0, onCons: t.onCons || 0, cost: t.cost != null ? t.cost : evRows.reduce((s, x) => s + x.cost, 0),
        units: evRows.reduce((s, x) => s + x.used, 0),
      });
      if (!evRows.length && !ev.revenue && !d.event) continue;   // empty "Event 5" etc.
      ev.date = ev.date || wbDate;
      evRows.forEach((x) => { x.ev = events.length; });
      events.push(ev);
      rows.push(...evRows);
    }
    if (!wbDate) wbDate = events.map((e) => e.date).filter(Boolean).sort()[0] || '';
    events.forEach((e) => { if (!e.date) e.date = wbDate; });
    return { date: wbDate, file: fileName, events, rows, warnings };
  }

  /* ---------- Storage (IndexedDB, one record per day) ---------- */

  const DB = 'crownCons', STORE = 'days';
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function tx(mode, fn) {
    const db = await idb();
    return new Promise((res, rej) => {
      const t = db.transaction(STORE, mode); const req = fn(t.objectStore(STORE));
      t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error);
    });
  }
  const put = (key, day) => tx('readwrite', (s) => s.put(day, key));
  const remove = (key) => tx('readwrite', (s) => s.delete(key));
  const clear = () => tx('readwrite', (s) => s.clear());
  async function all() {
    const db = await idb();
    return new Promise((res, rej) => {
      const out = {}; const t = db.transaction(STORE, 'readonly'); const req = t.objectStore(STORE).openCursor();
      req.onsuccess = () => { const cur = req.result; if (cur) { out[cur.key] = cur.value; cur.continue(); } };
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error);
    });
  }

  global.CrownCons = { isConsumptionWorkbook, read, put, remove, clear, all };
})(window);
