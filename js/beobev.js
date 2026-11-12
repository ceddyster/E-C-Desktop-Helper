/* The "Beverages on consumption" part of a BEO's beverage section, for the on-consumption sheets:
 * the items exactly as written (without their prices) and the times the on-consumption service runs. */
(function (global) {
  'use strict';
  const RANGE = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\b/;
  const hm = (h, m) => `${String(h).padStart(2, '0')}:${m}`;

  /** A BEO's beverage lines → { from, to, items: [names] } (items empty if nothing is on consumption).
   *  "Leeuwin Estate Sparkling Brut @ $75.00 per bottle" → "Leeuwin Estate Sparkling Brut". */
  function fromBEO(lines) {
    const out = { from: '', to: '', items: [] };
    let range = null, inOn = false;
    for (const raw of lines || []) {
      const t = String(raw).trim();
      const r = t.match(RANGE);
      if (r) { range = { from: hm(r[1], r[2]), to: hm(r[3], r[4]) }; inOn = false; continue; }
      if (/on consumption/i.test(t)) {
        // "Beverages on consumption - 4.5 Hours" starts the list. Pre-event drinks "Included in beverage on
        // consumption" also count from their start time.
        if (range && (!out.from || range.from < out.from)) out.from = range.from;
        if (range && (!out.to || range.to > out.to)) out.to = range.to;
        inOn = !/^included/i.test(t);
        continue;
      }
      if (!inOn) continue;
      if (/^\d+\s*@|beverage notes/i.test(t)) { inOn = false; continue; }
      const m = t.match(/^>?\s*(.+?)\s*@\s*\$[\d,.]+/);
      if (m && !out.items.some((x) => x.toLowerCase() === m[1].trim().toLowerCase())) out.items.push(m[1].trim());
    }
    return out;
  }

  global.CrownBeoBev = { fromBEO };
})(window);
