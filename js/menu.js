/* Banquet Menu reader (beverage items) and the helpers the on-consumption sheets use:
 *   - reading beverage items, by section, from a Banquet Menu PDF or workbook
 *   - pulling the "Beverages on consumption" items and times out of a BEO's beverage section
 *   - matching a BEO item ("Hahn Super Dry 3.5 @ $11.50 per bottle") to the menu's name for it
 *   - sorting items into sections (Sparkling, White wine, … Soft drinks & juice) */
(function (global) {
  'use strict';

  const CATS = ['Sparkling', 'White wine', 'Rosé', 'Red wine', 'Beer & cider', 'Non-alcoholic', 'Soft drinks & juice', 'Spirits', 'Cocktails', 'Other'];
  // Section headings in a menu → our sections.
  const HEADINGS = [
    [/sparkling|champagne|prosecco|bubbles/i, 'Sparkling'],
    [/ros[eé]/i, 'Rosé'],
    [/white/i, 'White wine'],
    [/red/i, 'Red wine'],
    [/non[\s-]?alc|alcohol[\s-]?free|zero|mocktail/i, 'Non-alcoholic'],
    [/beer|cider|seltzer|lager|ale\b/i, 'Beer & cider'],
    [/soft|juice|water|non[\s-]?alcoholic beverages/i, 'Soft drinks & juice'],
    [/spirit|liqueur|whisk|vodka|gin\b|rum\b/i, 'Spirits'],
    [/cocktail/i, 'Cocktails'],
  ];
  // An item's section from its name, when the menu doesn't say (BEO items, things added by hand).
  const ITEM_WORDS = [
    [/\b(0\.0|zero|non[\s-]?alc|alcohol[\s-]?free|edenvale)\b/i, 'Non-alcoholic'],
    [/sparkling wine|\bbrut\b|prosecco|champagne|cuv[eé]e|moet|mo[eë]t|veuve|chandon|blanc de|pet nat|spumante|\bnv\b/i, 'Sparkling'],
    [/ros[eé]\b/i, 'Rosé'],
    [/sauvignon|chardonnay|semillon|s[eé]millon|riesling|pinot gri|pinot grigio|moscato|vermentino|fiano|chenin|viognier|white blend|\bsem\b|\bssb\b|\bsb\b/i, 'White wine'],
    [/shiraz|cabernet|merlot|pinot noir|tempranillo|grenache|sangiovese|malbec|\bgsm\b|red blend|\bcab\b|\bcs\b/i, 'Red wine'],
    [/sparkling/i, 'Sparkling'],
    [/beer|lager|\bale\b|pilsner|pale|draught|hahn|corona|heineken|carlton|crown lager|peroni|asahi|stella|great northern|stone ?& ?wood|xxxx|dingo|byron|little creatures|james squire|cider|seltzer|isla\b|vodka cruiser|furphy|guinness|kirin|coopers|balter|gage roads/i, 'Beer & cider'],
    [/pepsi|coke|coca|cola|lemonade|solo|soda|lld|lemon lime|bitters|ginger ale|ginger beer|tonic|juice|water|sprite|fanta|schweppes|soft drink|mineral|cordial/i, 'Soft drinks & juice'],
    [/vodka|gin\b|rum\b|whisk|bourbon|tequila|hennes|cognac|brandy|scotch|jameson|jack daniel|liqueur|baileys|aperol|campari|kahlua|midori|spirit/i, 'Spirits'],
    [/cocktail|spritz|margarita|martini|mojito/i, 'Cocktails'],
  ];
  const headingCat = (t) => { for (const [re, c] of HEADINGS) if (re.test(t)) return c; return null; };
  function guessCat(name) { for (const [re, c] of ITEM_WORDS) if (re.test(name)) return c; return 'Other'; }

  // Soft drinks as written on the on-consumption form, for "Assorted soft drinks…" on a BEO.
  const SOFTS = ['Pepsi Gls', 'Pepsi Max Gls', 'Soda Gls', 'Lemonade Gls', 'Solo Gls', 'LLD Gls'];

  /* ---------- Matching names ---------- */
  const STOP = new Set(['the', 'and', 'per', 'bottle', 'bottles', 'btl', 'gls', 'glass', 'glasses', 'can', 'cans', 'of', 'nv', 'wa', 'by', 'estate', 'wines', 'winery', 'x']);
  const tokens = (s) => String(s).toLowerCase().replace(/ros[eé]/g, 'rose').replace(/%/g, '').replace(/[^a-z0-9.\s]/g, ' ').split(/\s+/)
    .map((w) => w.replace(/^\.+|\.+$/g, '')).filter((w) => w && !STOP.has(w));
  function similarity(a, b) {
    const A = new Set(tokens(a)), B = new Set(tokens(b));
    if (!A.size || !B.size) return 0;
    let n = 0; for (const w of A) if (B.has(w)) n++;
    return (2 * n) / (A.size + B.size);
  }
  /** The menu item a BEO / typed name refers to, or null. */
  function bestMatch(name, items) {
    let best = null, score = 0;
    for (const it of items) { const s = similarity(name, it.name); if (s > score) { score = s; best = it; } }
    return score >= 0.6 ? best : null;
  }

  /* ---------- BEO: on-consumption items and times ---------- */
  const RANGE = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\b/;
  const hm = (h, m) => `${String(h).padStart(2, '0')}:${m}`;
  /** From a BEO's beverage lines → { from, to, items: [{ name, per, cat }] } (items empty if none on consumption). */
  function fromBEO(lines) {
    const out = { from: '', to: '', items: [] };
    let range = null, inOn = false;
    for (const raw of lines || []) {
      const t = String(raw).trim();
      const r = t.match(RANGE);
      if (r) { range = { from: hm(r[1], r[2]), to: hm(r[3], r[4]) }; inOn = false; continue; }
      if (/on consumption/i.test(t)) {
        // "Beverages on consumption - 4.5 Hours" starts the list; pre-event drinks "Included in beverage on
        // consumption" also count from their start time.
        if (range && (!out.from || range.from < out.from)) out.from = range.from;
        if (range && (!out.to || range.to > out.to)) out.to = range.to;
        inOn = !/^included/i.test(t);
        continue;
      }
      if (!inOn) continue;
      if (/^\d+\s*@|beverage notes|^please note|^the final amount/i.test(t)) { if (/^\d+\s*@|beverage notes/i.test(t)) inOn = false; continue; }
      const m = t.match(/^>?\s*(.+?)\s*@\s*\$[\d,.]+\s*(.*)$/);
      if (!m) continue;
      const name = m[1].trim(), per = m[2].toLowerCase();
      if (/assorted soft|soft drinks/i.test(name)) {
        SOFTS.forEach((s) => out.items.push({ name: s, cat: 'Soft drinks & juice', fromBEO: true }));
        if (/orange/i.test(name) || /juices/i.test(name)) out.items.push({ name: 'Orange Juice', cat: 'Soft drinks & juice', fromBEO: true });
        if (/apple/i.test(name) || /juices/i.test(name)) out.items.push({ name: 'Apple Juice', cat: 'Soft drinks & juice', fromBEO: true });
        continue;
      }
      out.items.push({ name, per, cat: guessCat(name), fromBEO: true });
    }
    return out;
  }

  /* ---------- Menu files ---------- */
  const PRICE = /\$\s?\d[\d,]*(\.\d{1,2})?/;
  /** Lines of text → [{ name, cat }]. Section headings set the section; items are lines with a price,
   *  or (for menus without prices) short name-like lines under a section heading. */
  function itemsFromLines(lines) {
    const priced = lines.filter((t) => PRICE.test(t)).length;
    const items = [], seen = new Set();
    let cat = null;
    for (const raw of lines) {
      const t = raw.replace(/\s+/g, ' ').trim();
      if (!t || t.length > 90) continue;
      const hasPrice = PRICE.test(t);
      const hc = !hasPrice && t.length <= 40 ? headingCat(t) : null;
      const isHeading = hc && (t === t.toUpperCase() || t.split(' ').length <= 4);
      if (isHeading) { cat = hc; continue; }
      let name = '';
      if (hasPrice) name = t.split(PRICE)[0];
      else if (priced < 5 && cat && t.length <= 60 && /^[A-Z0-9]/.test(t) && !/[.:]$/.test(t) && t.split(' ').length <= 9) name = t;
      name = name.replace(/[.\-–—_·|]+\s*$/, '').replace(/\s*\b(per|by the)\s+(bottle|glass|btl|gls)\b.*$/i, '').replace(/\s*\(?(btl|bottle|glass|gls)\)?\s*$/i, '').trim();
      if (!name || name.length < 3 || /^(per|price|total|minimum|includes?|package|hours?)\b/i.test(name) || /\d+\s*(hours?|hrs?)\b/i.test(name)) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ name, cat: cat || guessCat(name) });
    }
    return items;
  }

  /** PDF pages → text lines, read column by column. A printed line is split where a new column starts:
   *  after an item's price ("Hahn Premium Light $11.50 | Corona $13.50") or at a wide gap
   *  ("AUSTRALIAN BEER | IMPORTED BEER"). Segments are then grouped into columns by where they start. */
  function pdfLines(pages, toLines, lineText) {
    const out = [];
    for (const pg of pages) {
      const segs = [];
      for (const l of toLines(pg.items)) {
        let cur = [];
        for (const it of l.items) {
          const prev = cur[cur.length - 1];
          if (prev) {
            const gap = it.x - (prev.x + (prev.w || prev.str.length * 5));
            const startsWord = /^[A-Za-z(]/.test(it.str);
            const hadPrice = cur.some((c) => /\$/.test(c.str));
            if (startsWord && (hadPrice || gap > 40)) { segs.push({ y: l.y, x: cur[0].x, items: cur }); cur = []; }
          }
          cur.push(it);
        }
        if (cur.length) segs.push({ y: l.y, x: cur[0].x, items: cur });
      }
      // Columns: segments starting within 25pt of each other, left to right; each read top to bottom.
      const cols = [];
      for (const sg of [...segs].sort((a, b) => a.x - b.x)) {
        const c = cols.find((k) => Math.abs(k.x - sg.x) <= 25);
        if (c) c.segs.push(sg); else cols.push({ x: sg.x, segs: [sg] });
      }
      for (const c of cols) c.segs.sort((a, b) => b.y - a.y).forEach((sg) => out.push(lineText(sg).replace(/\$\s*(\d+)\s+(\d*\.\d{2})/, (m, a, b) => '$' + a + b)));
    }
    return out;
  }

  const nameSaysMenu = (name) => /menu|beverage|drinks?\b|wine list|bev list/i.test(name);
  /** A Banquet Menu PDF? (named like one, or full of beverage sections and prices) */
  function looksLike(name, lines) {
    const heads = lines.filter((t) => t.length <= 40 && !PRICE.test(t) && headingCat(t)).length;
    return (nameSaysMenu(name) && heads >= 1) || (heads >= 3 && lines.filter((t) => PRICE.test(t)).length >= 8);
  }
  function read(name, lines) {
    const items = itemsFromLines(lines);
    if (items.length < 3) throw new Error('This looks like a menu but no beverage items were found in it.');
    return { title: String(name).replace(/\.[a-z0-9]+$/i, ''), items };
  }
  /** Workbook menus: the text of each row, in order. */
  function sheetLines(wb) {
    const out = [];
    for (const sn of wb.SheetNames) {
      const rows = global.XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: false, defval: '', blankrows: false });
      for (const r of rows) out.push(r.map((v) => String(v).trim()).filter(Boolean).join(' '));
    }
    return out;
  }

  global.CrownMenu = { CATS, guessCat, bestMatch, similarity, fromBEO, pdfLines, looksLike, read, sheetLines, nameSaysMenu, SOFTS };
})(window);
