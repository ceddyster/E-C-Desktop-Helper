/* Matches a TL sheet "Duties" event name to a BEO, allowing for the small differences that
 * creep in when people type names by hand:
 *
 *   "REBECCA & PHIL WEDDING"   ↔ "Rebecca & Phill's Wedding Reception"   (Phil/Phill, 's, extra word)
 *   "PGA GALA DINNER"          ↔ "(Inc) PGA Conference & Gala Dinner"
 *   "TOWN OF VIC PARK DINNER"  ↔ "Town of Victoria Park Dinner"           (short form)
 *
 * Names are split into words. "Distinctive" words (names, companies) count double;
 * event-type words (wedding, dinner, gala…) count once. At least one distinctive word must
 * match, so two weddings on the same day don't get mixed up. If the TL bar code points to the
 * BEO's room (AST3 ↔ Astral 3, CB3 ↔ Crown Ballroom 3), that's a tie-breaking bonus.
 */
(function (global) {
  'use strict';

  const STOP = new Set(['the', 'of', 'and', 'for', 'a', 'an', 'at', 'in', 'on', 'to', 'inc', 's', 'with', 'by', 'x']);
  const GENERIC = new Set(['wedding', 'weddings', 'reception', 'ceremony', 'dinner', 'lunch', 'luncheon', 'breakfast', 'brunch',
    'cocktail', 'cocktails', 'conference', 'gala', 'function', 'event', 'events', 'party', 'day', 'night', 'awards', 'award',
    'drinks', 'networking', 'meeting', 'seminar', 'forum', 'summit', 'celebration', 'ball', 'launch', 'presentation',
    'morning', 'afternoon', 'evening', 'tea', 'canapes', 'pre', 'post', 'annual', 'group', 'banquet',
    'foyer', 'bar', 'bars', 'bir', 'champagne', 'wine', 'beer', 'service']);

  // TL bar code prefixes → room names as they appear on BEOs.
  const BAR_ROOMS = [
    [/^AST/i, 'astral'], [/^CB/i, 'crown ballroom'], [/^GB/i, 'grand ballroom'], [/^STU/i, 'studio'],
    [/^RIV/i, 'riverside'], [/^PAV/i, 'pavilion'], [/^POOL/i, 'pool'], [/^BOT/i, 'botanical'],
  ];

  const THRESHOLD = 0.6;

  function words(s) {
    return String(s || '').toLowerCase()
      .replace(/[’']s\b/g, '')                // Phill's → Phill
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((w) => w && !STOP.has(w));
  }

  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 3;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return d[a.length][b.length];
  }

  /** Same word, a short form of it (vic → victoria), or a small typo (phil → phill). */
  function wordEq(a, b) {
    if (a === b) return true;
    const short = a.length < b.length ? a : b, long = a.length < b.length ? b : a;
    if (short.length >= 3 && long.startsWith(short) && !/^\d/.test(short)) return true;
    if (Math.min(a.length, b.length) >= 4) return lev(a, b) <= (Math.min(a.length, b.length) >= 7 ? 2 : 1);
    return false;
  }

  function barSuitsVenue(bars, venue) {
    const v = String(venue || '').toLowerCase();
    if (!v) return false;
    return (bars || []).some((bar) => {
      const room = BAR_ROOMS.find(([re]) => re.test(bar));
      if (!room || !v.includes(room[1])) return false;
      const num = String(bar).match(/\d+/);
      return !num || new RegExp(`\\b${num[0]}\\b`).test(v);
    });
  }

  /** 0…1 (plus a small bonus) — how well a TL duty matches a BEO event. 0 = no match. */
  function score(duty, bars, beo) {
    const t = [...new Set(words(duty))];
    if (!t.length) return 0;
    const b = [...new Set(words([beo.title, beo.subtitle, beo.beo && beo.beo.account].filter(Boolean).join(' ')))];
    const has = (w) => b.some((x) => wordEq(w, x));
    const dist = t.filter((w) => !GENERIC.has(w)), gen = t.filter((w) => GENERIC.has(w));
    const md = dist.filter(has).length, mg = gen.filter(has).length;
    if (dist.length && !md) return 0;                       // needs at least one name/company word in common
    let s = (2 * md + mg) / (2 * dist.length + gen.length);
    if (!dist.length && s < 1) return 0;                    // only generic words: all must match
    // The bar ↔ room hint only separates names that already match well enough; it never makes a match on its own.
    if (s >= THRESHOLD && (barSuitsVenue(bars, beo.venue) || (beo.beo && (beo.beo.functions || []).some((f) => barSuitsVenue(bars, f.venue))))) s += 0.15;
    return s;
  }

  /** Best-matching BEO for a TL duty among that day's BEOs, or null. */
  function best(duty, bars, beos) {
    const hits = beos.map((beo) => ({ beo, sc: score(duty, bars, beo) })).filter((h) => h.sc >= THRESHOLD)
      .sort((x, y) => y.sc - x.sc);
    if (!hits.length) return null;
    // A duty made only of event-type words ("WEDDING") is ambiguous when several BEOs fit;
    // only the bar's room can settle it.
    const generic = !words(duty).some((w) => !GENERIC.has(w));
    if (generic && hits.length > 1) {
      const byRoom = hits.filter((h) => h.sc > 1);
      return byRoom.length === 1 ? byRoom[0].beo : null;
    }
    return hits[0].beo;
  }

  const key = (s) => words(s).join(' ');

  global.CrownMatch = { score, best, words, wordEq, barSuitsVenue, key, THRESHOLD };
})(typeof window !== 'undefined' ? window : globalThis);
