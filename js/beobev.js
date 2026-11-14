/* The "Beverages on consumption" part of a BEO's beverage section, for the on-consumption sheets:
 * the items exactly as written (without their prices) and the times the on-consumption service runs. */
(function (global) {
  'use strict';
  const RANGE = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\b/;
  const hm = (h, m) => `${String(h).padStart(2, '0')}:${m}`;

  // "Assorted soft drinks and juices / orange juice" on a BEO means these, each counted on the sheet.
  const SOFTS = ['Pepsi', 'Pepsi Max', 'Lemonade', 'Solo', 'Soda Water', 'Orange Juice', 'Apple Juice'];

  /** A BEO's beverage lines → { has, from, to, items: [names] }. `has`: the BEO has a "Beverages on
   *  consumption" line (pre-event drinks "included in beverage on consumption" alone don't count).
   *  "Leeuwin Estate Sparkling Brut @ $75.00 per bottle" → "Leeuwin Estate Sparkling Brut". */
  function fromBEO(lines) {
    const out = { has: false, from: '', to: '', items: [] };
    const add = (name) => { if (!out.items.some((x) => x.toLowerCase() === name.toLowerCase())) out.items.push(name); };
    let range = null, inOn = false;
    for (const raw of lines || []) {
      const t = String(raw).trim();
      const r = t.match(RANGE);
      if (r) { range = { from: hm(r[1], r[2]), to: hm(r[3], r[4]) }; inOn = false; continue; }
      if (/on consumption/i.test(t) && !/^>/.test(t)) {   // a heading, not a note ("> … beverages on consumption: Hannah")
        // "Beverages on consumption - 4.5 Hours" starts the list. Pre-event drinks "Included in beverage on
        // consumption" also count from their start time.
        if (range && (!out.from || range.from < out.from)) out.from = range.from;
        if (range && (!out.to || range.to > out.to)) out.to = range.to;
        inOn = /beverages? on consumption/i.test(t) && !/^included/i.test(t);
        if (inOn) out.has = true;
        continue;
      }
      if (!inOn) continue;
      if (/^\d*\s*@|beverage notes|corkage|supplied by/i.test(t)) { inOn = false; continue; }
      const m = t.match(/^>?\s*(.+?)\s*@\s*\$[\d,.]+/);
      if (!m) continue;
      if (/assorted soft drinks?/i.test(m[1])) SOFTS.forEach(add);
      else add(m[1].trim());
    }
    return out;
  }

  /** Every product the bar has to supply for an event, for the bar orders: the "Beverages on consumption"
   *  items and the products in any beverage package, as written on the BEO. Corkage / client-supplied
   *  drinks aren't included, nor are notes, prices or guest counts. → { items: [names], packages: [package lines] } */
  function orderItems(lines) {
    const out = { items: [], packages: [], clientSupplied: false };
    const add = (name) => { name = name.replace(/\s+/g, ' ').trim(); if (name && !out.items.some((x) => x.toLowerCase() === name.toLowerCase())) out.items.push(name); };
    let mode = '';          // 'on' | 'pkg' | ''
    for (const raw of lines || []) {
      const t = String(raw).replace(/\s+/g, ' ').trim();
      if (!t) continue;
      if (RANGE.test(t)) { mode = ''; continue; }
      if (/corkage|client supplied|supplied by (the )?client|beverage supplied by|sponsor/i.test(t)) { if (!/^>/.test(t)) out.clientSupplied = true; mode = ''; continue; }
      // "Beverages on consumption", "VIP Tables Spirits on Consumption", "Heineken Zero - Consumption"…
      // (headings, not "> notes"). Soft drinks on consumption aren't ordered here.
      if (!/^>/.test(t) && (/\bon consumption\b/i.test(t) || /-\s*consumption\b/i.test(t)) && !/^included/i.test(t)) { mode = /soft drinks?/i.test(t) ? '' : 'on'; continue; }
      if (/package/i.test(t) && !/^>/.test(t) && !/included in/i.test(t)) { mode = 'pkg'; out.packages.push(t); continue; }
      if (!mode) continue;
      if (/^\d*\s*@|beverage notes|^~+$/i.test(t)) { mode = ''; continue; }
      if (/^(please note|the final amount|note:|\*)/i.test(t) || /\bguests?\s*@|per person\b.*\btotal|event spend/i.test(t)) continue;
      if (mode === 'on') { const m = t.match(/^>?\s*(.+?)\s*@\s*\$[\d,.]+/); if (m) add(m[1]); continue; }
      // Package products: one per line, perhaps with "> " in front or a price after.
      const name = t.replace(/^>\s*/, '').replace(/\s*@\s*\$.*$/, '').replace(/^\d+\s*x\s*/i, '');
      if (name.length >= 3 && name.length <= 80 && !/hours?\b|minutes?\b|^(includes?|selection of|choice of)\b/i.test(name)) add(name);
    }
    return out;
  }

  global.CrownBeoBev = { fromBEO, orderItems };
})(window);
