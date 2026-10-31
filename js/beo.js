/* Reader for Crown BEO (Banquet Event Order) PDFs exported from Delphi.
 *
 * Page 1 has a header block (Account, Booking Name, BEO Name, Contact, Event Manager, BEO#)
 * and a function table: DATE | TIME | VENUE | EVENT | SET-UP | GTD | ROOM HIRE.
 * The left column of the following pages holds sections (Menu, Dietary Requirements,
 * Beverage, Technical Requirement, ...). We keep the Beverage section for the bar team.
 *
 * Each BEO becomes one dashboard event per date, titled with the Booking Name — which is
 * what the TL sheet's Duties column should say, so bar staff can be matched to it.
 */
(function (global) {
  'use strict';

  const SECTION_HEADINGS = /^(menu|program|dietary requirements|beverage|technical requirement|health and safety|miscellaneous|setup|billing instructions|package|audio visual|entertainment|accommodation)$/i;
  const NON_GUEST = /client access|bump|crew|set ?up|pack ?(down|up)|rehearsal|storage|hold|load ?(in|out)|delivery|access/i;

  let loading = null;
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load the PDF reader (' + src + ').'));
      document.head.appendChild(s);
    });
  }
  function pdfjs() {
    if (global.pdfjsLib) return Promise.resolve(global.pdfjsLib);
    if (!loading) {
      // The worker script is also loaded on the page so PDFs still open from a local file (file://),
      // where browsers block background workers.
      loading = loadScript('vendor/pdfjs/pdf.min.js?v=3.11.174')
        .then(() => loadScript('vendor/pdfjs/pdf.worker.min.js?v=3.11.174'))
        .then(() => {
          global.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
          return global.pdfjsLib;
        });
    }
    return loading;
  }

  /** All text items as {page, x, y, str}, grouped into lines (top to bottom, left to right). */
  async function readItems(buf) {
    const lib = await pdfjs();
    const doc = await lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const height = page.getViewport({ scale: 1 }).height;
      const tc = await page.getTextContent();
      const items = tc.items.filter((it) => it.str && it.str.trim())
        .map((it) => ({ page: p, x: it.transform[4], y: it.transform[5], str: it.str.trim() }));
      pages.push({ items, height, width: page.getViewport({ scale: 1 }).width });
    }
    return pages;
  }

  function toLines(items, tol = 2.5) {
    const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    for (const it of sorted) {
      const line = lines.find((l) => Math.abs(l.y - it.y) <= tol);
      if (line) line.items.push(it); else lines.push({ y: it.y, items: [it] });
    }
    lines.forEach((l) => l.items.sort((a, b) => a.x - b.x));
    return lines.sort((a, b) => b.y - a.y);
  }
  const lineText = (l) => l.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();

  function ddmmyy(s) {
    const m = String(s).match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/);
    if (!m) return null;
    let y = +m[3]; if (y < 100) y += 2000;
    return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  }

  function headerValue(items, label, maxX) {
    const lab = items.find((i) => i.str.replace(/\s+/g, ' ').toLowerCase() === label.toLowerCase());
    if (!lab) return '';
    const limit = maxX || (lab.x < 280 ? 290 : 1e9);
    return items.filter((i) => Math.abs(i.y - lab.y) <= 2 && i.x > lab.x + 5 && i.x < limit)
      .sort((a, b) => a.x - b.x).map((i) => i.str).join(' ').trim();
  }

  function functionTable(page) {
    const lines = toLines(page.items);
    const hi = lines.findIndex((l) => ['DATE', 'TIME', 'VENUE', 'EVENT'].every((h) => l.items.some((i) => i.str.toUpperCase() === h)));
    if (hi < 0) return [];
    const cols = lines[hi].items.map((i) => ({ name: i.str.toUpperCase(), x: i.x }));
    const colOf = (x) => { let c = cols[0]; for (const k of cols) if (k.x <= x + 4) c = k; return c.name; };
    const rows = [], loose = [];
    for (let i = hi + 1; i < lines.length; i++) {
      const l = lines[i], txt = lineText(l);
      if (/^(package|menu)\b/i.test(txt) || SECTION_HEADINGS.test(txt)) break;
      const cells = {};
      for (const it of l.items) { const c = colOf(it.x); cells[c] = cells[c] ? cells[c] + ' ' + it.str : it.str; }
      const date = ddmmyy(cells.DATE || '');
      if (date) {
        const t = (cells.TIME || '').match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
        rows.push({ y: l.y, date, start: t ? t[1].padStart(5, '0') : null, end: t ? t[2].padStart(5, '0') : null,
          venue: cells.VENUE || '', event: cells.EVENT || '', setup: cells['SET-UP'] || '', gtd: parseInt(cells.GTD, 10) || null });
      } else if (cells.EVENT) {
        loose.push({ y: l.y, text: cells.EVENT });
      }
      if (rows.length && !date && !cells.EVENT && l.y < rows[rows.length - 1].y - 40) break;
    }
    // Wrapped event names ("Crew Catering - AV" / "Desk") sit above and below their row.
    for (const lo of loose) {
      let best = null;
      for (const r of rows) if (!best || Math.abs(r.y - lo.y) < Math.abs(best.y - lo.y)) best = r;
      if (best) { best._parts = best._parts || []; best._parts.push(lo); }
    }
    for (const r of rows) {
      if (r._parts) {
        const parts = [...r._parts, ...(r.event ? [{ y: r.y, text: r.event }] : [])].sort((a, b) => b.y - a.y);
        r.event = parts.map((p) => p.text).join(' ');
        delete r._parts;
      }
      delete r.y;
    }
    return rows;
  }

  function beverageSection(pages, functionVenues) {
    const out = [];
    let inBev = false;
    for (const pg of pages) {
      const mid = pg.width * 0.48;
      const left = pg.items.filter((i) => i.x < mid && i.y > 45 && i.y < pg.height - 60);
      for (const l of toLines(left)) {
        const t = lineText(l);
        if (/^beverage$/i.test(t)) { inBev = true; continue; }
        if (!inBev) continue;
        if (SECTION_HEADINGS.test(t)) { inBev = false; continue; }
        if (t.length <= 1 || functionVenues.has(t.toLowerCase())) continue;
        if (out.length && /^[a-z(]/.test(t)) out[out.length - 1] += ' ' + t; // wrapped line
        else out.push(t);
      }
    }
    return out;
  }

  /** Returns [{kind:'ready', isBEO, beoNumber, ...}] in the same shape as the other readers. */
  async function readBEO(fileName, buf) {
    const pages = await readItems(buf);
    if (!pages.length) throw new Error('This PDF has no pages.');
    const p1 = pages[0].items;
    const booking = headerValue(p1, 'Booking Name:');
    if (!booking) throw new Error('This PDF doesn\'t look like a BEO (no "Booking Name").');
    const beoNoItem = p1.find((i) => /^BEO#?:?\s*\d+/i.test(i.str));
    const beoNumber = beoNoItem ? beoNoItem.str.match(/\d+/)[0] : '';
    const info = {
      number: beoNumber,
      type: (p1.find((i) => i.y > pages[0].height - 40 && i.x < 150) || {}).str || '',
      beoName: headerValue(p1, 'BEO Name:'),
      account: headerValue(p1, 'Account:'),
      contact: headerValue(p1, 'Contact:'),
      onsite: headerValue(p1, 'OnSite:'),
      eventManager: headerValue(p1, 'Event Manager:'),
    };
    const rows = functionTable(pages[0]);
    const venues = new Set(rows.map((r) => r.venue.toLowerCase()).filter(Boolean));
    const beverage = beverageSection(pages, venues);

    const byDate = new Map();
    rows.forEach((r) => { if (!byDate.has(r.date)) byDate.set(r.date, []); byDate.get(r.date).push(r); });
    if (!byDate.size) {
      const hd = p1.map((i) => global.CrownParse.toISODate(i.str)).find(Boolean);
      if (hd) byDate.set(hd, []);
    }
    const events = [];
    for (const [date, fns] of byDate) {
      const guest = fns.filter((f) => !NON_GUEST.test(f.event));
      const use = guest.length ? guest : fns;
      // Main function: the one named like the BEO ("DINNER"), else the biggest (later wins ties).
      const named = info.beoName && use.find((f) => f.event.toLowerCase() === info.beoName.toLowerCase());
      const main = named || use.reduce((a, b) => ((b.gtd || 0) >= (a.gtd || 0) ? b : a), use[0] || {});
      const starts = use.map((f) => f.start).filter(Boolean).sort();
      // End: the last guest function to finish (times after midnight count as late).
      const late = (t) => (t && t < '06:00' ? '2' + t : t);
      const ends = use.map((f) => f.end).filter(Boolean).sort((a, b) => late(a).localeCompare(late(b)));
      events.push({
        date, title: booking, subtitle: info.beoName, start: starts[0] || null, end: ends[ends.length - 1] || null,
        venue: main.venue || '', pax: main.gtd ? String(main.gtd) : '', notes: '', staff: [],
        beo: Object.assign({}, info, { functions: fns, beverage }),
      });
    }
    const warnings = [];
    if (!rows.length) warnings.push('Couldn\'t read the function table — only the date and name were picked up.');
    return [{ label: `BEO ${beoNumber} · ${booking}${info.beoName ? ' · ' + info.beoName : ''}`, kind: 'ready', isBEO: true, beoNumber,
      ready: { events, shifts: [], warnings } }];
  }

  global.CrownBEO = { readBEO };
})(window);
