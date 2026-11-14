/* Bar orders: how many bottles of each product the events in a date range need.
 *
 * Event types: Seated Sports, Seated Corporate, Seated Wedding (the "seated" figures) and
 * Cocktail / Networking / Sundowner (the "cocktail" figures). Everything is in whole bottles.
 *
 * Seated (tables = guests ÷ 10, rounded up):
 *   Beer (full strength)  guests × per person (Sports 5 · Corporate 3 · Wedding 3)
 *   Light beer            guests × per person (Sports 3 · Corporate 2 · Wedding 2)
 *   Red wine / White wine tables × 2.5 · Sparkling tables × 5
 * Cocktail: guests × glasses per person × assumption % ÷ glasses per bottle, for each of
 *   Sparkling · Red wine 1 & 2 · White wine 1 & 2 · Beer 1 & 2 · Light beer 1.
 * Two of a kind (e.g. two reds): the one picked as primary is "1", the other "2". On a seated event the
 * category's total is shared in the same proportions (reds 15 : 10, whites 20 : 15, beers 30 : 25).
 * Three or more: the others share the "2" amount. A category with only a "1" (sparkling, light beer) is
 * shared equally. Spirits: 6 bottles of each. Soft drinks and anything else aren't ordered here.
 * Light beer includes light, mid-strength, zero-alcohol beer and cider. Rosé counts as white wine.
 * Menu Tasting: 1 bottle of each wine; beers (and anything else) aren't ordered. */
(function (global) {
  'use strict';

  const TYPES = [['sports', 'Seated Sports'], ['corporate', 'Seated Corporate'], ['wedding', 'Seated Wedding'], ['cocktail', 'Cocktail / Networking / Sundowner'], ['tasting', 'Menu Tasting']];
  const CATS = [['sparkling', 'Sparkling'], ['white', 'White wine'], ['red', 'Red wine'], ['beer', 'Beer'], ['light', 'Light beer (incl. mid, zero, cider)'], ['spirits', 'Spirits'], ['none', 'Not ordered (soft drinks etc.)']];
  const CAT_NAME = Object.fromEntries(CATS);

  const DEFAULTS = {
    seated: {
      beer: { sports: 5, corporate: 3, wedding: 3 },     // bottles per person
      light: { sports: 3, corporate: 2, wedding: 2 },    // bottles per person
      red: 2.5, white: 2.5, sparkling: 5,                // bottles per table
      perTable: 10,
    },
    cocktail: {
      sparkling: [{ gpp: 2, gpb: 4, pct: 30 }],
      red: [{ gpp: 2, gpb: 6, pct: 15 }, { gpp: 2, gpb: 6, pct: 10 }],
      white: [{ gpp: 2, gpb: 7, pct: 20 }, { gpp: 2, gpb: 7, pct: 15 }],
      beer: [{ gpp: 3, gpb: 1, pct: 30 }, { gpp: 3, gpb: 1, pct: 25 }],
      light: [{ gpp: 2, gpb: 1, pct: 10 }],
    },
    spirits: 6,
  };

  /** The event type from what the BEO says; Seated Corporate unless it says otherwise. */
  function guessType(e) {
    const b = e.beo || {};
    const text = [e.title, e.subtitle, b.beoName, b.type, ...(b.functions || []).map((f) => f.event)].filter(Boolean).join(' ').toLowerCase();
    if (/menu tasting/.test(text)) return 'tasting';
    if (/wedding/.test(text)) return 'wedding';
    if (/cocktail|networking|sundowner|canap|drinks reception|stand[- ]?up/.test(text)) return 'cocktail';
    if (/sport|football|\bafl\b|cricket|rugby|racing|grand final|brownlow|medal/.test(text)) return 'sports';
    return 'corporate';
  }

  /** A product's category for ordering: from the Banquet Menu when it's on one, else from its name. */
  function categorise(name, menuItems) {
    const M = global.CrownMenu;
    const n = String(name).toLowerCase();
    const m = M && menuItems && menuItems.length ? M.bestMatch(name, menuItems) : null;
    const cat = m ? m.cat : M ? M.guessCat(name) : 'Other';
    const beerish = cat === 'Beer & cider' || /beer|lager|ale\b|pilsner|cider|seltzer/.test(n);
    const light = /\blight\b|\bmid\b|mid[- ]?strength|3\.5|\bzero\b|0\.0|non[\s-]?alc|alcohol[\s-]?free|cider/.test(n);
    let c;
    if (cat === 'Soft drinks & juice' || /soft drinks?|juice|soda water|mineral water|sparkling water/.test(n)) c = 'none';
    else if (beerish && light) c = 'light';
    else if (cat === 'Non-alcoholic') c = beerish || /zero|0\.0/.test(n) ? 'light' : 'none';
    else if (cat === 'Beer & cider') c = 'beer';
    else if (cat === 'Sparkling') c = 'sparkling';
    else if (cat === 'White wine' || cat === 'Rosé') c = 'white';
    else if (cat === 'Red wine') c = 'red';
    else if (cat === 'Spirits') c = 'spirits';
    else c = 'none';
    return { cat: c, fromMenu: !!m };
  }

  const up = (x) => Math.max(0, Math.ceil(x - 1e-9));

  /** Bottles for one event. products: [{ name, cat }] in BEO order; primary: { red: name, … }.
   *  → { tables, lines: [{ name, cat, bottles, how }] } */
  function compute({ type, guests, products, primary, params }) {
    const P = params || DEFAULTS;
    const pax = Math.max(0, +guests || 0);
    if (type === 'tasting') {
      const lines = products.map((p) => (['sparkling', 'white', 'red'].includes(p.cat)
        ? { name: p.name, cat: p.cat, bottles: 1, how: 'menu tasting: 1 bottle of each wine' }
        : { name: p.name, cat: p.cat, bottles: 0, how: p.cat === 'none' ? 'not ordered' : 'menu tasting: only wine is ordered' }));
      const order = CATS.map((c) => c[0]);
      lines.sort((a, b) => order.indexOf(a.cat) - order.indexOf(b.cat));
      return { tables: 0, lines };
    }
    const seated = type !== 'cocktail';
    const tables = seated ? Math.ceil(pax / (P.seated.perTable || 10)) : 0;
    const lines = [];
    const groups = {};
    for (const p of products) (groups[p.cat] = groups[p.cat] || []).push(p);
    for (const [cat, list] of Object.entries(groups)) {
      if (cat === 'none') { list.forEach((p) => lines.push({ name: p.name, cat, bottles: 0, how: 'not ordered' })); continue; }
      if (cat === 'spirits') { list.forEach((p) => lines.push({ name: p.name, cat, bottles: P.spirits, how: `spirits: ${P.spirits} bottles each` })); continue; }
      // Primary first, then the rest in BEO order.
      const pri = primary && primary[cat] && list.find((p) => p.name === primary[cat]);
      const ordered = pri ? [pri, ...list.filter((p) => p !== pri)] : list;
      const slots = P.cocktail[cat] || [];
      if (seated) {
        const total = cat === 'beer' ? pax * P.seated.beer[type] : cat === 'light' ? pax * P.seated.light[type] : tables * P.seated[cat];
        const basis = cat === 'beer' || cat === 'light' ? `${pax} guests × ${cat === 'beer' ? P.seated.beer[type] : P.seated.light[type]} per person` : `${tables} tables × ${P.seated[cat]} per table`;
        if (ordered.length === 1) lines.push({ name: ordered[0].name, cat, bottles: up(total), how: basis });
        else if (slots.length >= 2) {
          const w1 = slots[0].pct, w2 = slots[1].pct, share = w1 + w2 || 1;
          lines.push({ name: ordered[0].name, cat, bottles: up(total * w1 / share), how: `${basis}; primary ${w1} of ${share} parts` });
          const rest = ordered.slice(1);
          rest.forEach((p) => lines.push({ name: p.name, cat, bottles: up(total * w2 / share / rest.length), how: `${basis}; ${w2} of ${share} parts${rest.length > 1 ? ` shared by ${rest.length}` : ''}` }));
        } else ordered.forEach((p) => lines.push({ name: p.name, cat, bottles: up(total / ordered.length), how: `${basis}${ordered.length > 1 ? `, shared by ${ordered.length}` : ''}` }));
      } else {
        const q = (s) => pax * s.gpp * s.pct / 100 / s.gpb;
        const desc = (s, n) => `${pax} guests × ${s.gpp} × ${s.pct}% ÷ ${s.gpb}${n > 1 ? `, shared by ${n}` : ''}`;
        if (!slots.length) continue;
        if (ordered.length === 1 || slots.length === 1) ordered.forEach((p) => lines.push({ name: p.name, cat, bottles: up(q(slots[0]) / ordered.length), how: desc(slots[0], ordered.length) }));
        else {
          lines.push({ name: ordered[0].name, cat, bottles: up(q(slots[0])), how: `${CAT_NAME[cat]} 1: ${desc(slots[0], 1)}` });
          const rest = ordered.slice(1);
          rest.forEach((p) => lines.push({ name: p.name, cat, bottles: up(q(slots[1]) / rest.length), how: `${CAT_NAME[cat]} 2: ${desc(slots[1], rest.length)}` }));
        }
      }
    }
    const order = CATS.map((c) => c[0]);
    lines.sort((a, b) => order.indexOf(a.cat) - order.indexOf(b.cat));
    return { tables, lines };
  }

  global.CrownOrders = { TYPES, CATS, CAT_NAME, DEFAULTS, guessType, categorise, compute };
})(window);
