/* Finds which cells are written in bold in an .xlsx workbook.
 *
 * The TL sheets mark event names in bold, but the spreadsheet library we use doesn't report
 * fonts. An .xlsx file is a zip of XML files, so this reads the formatting straight from them:
 *   xl/styles.xml         → which cell styles use a bold font
 *   xl/sharedStrings.xml  → text with bold formatting applied inside the cell
 *   xl/worksheets/*.xml   → which style each cell uses
 */
(function (global) {
  'use strict';

  const dec = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const attr = (attrs, name) => { const m = attrs.match(new RegExp(`(?:^|\\s)(?:\\w+:)?${name}="([^"]*)"`)); return m ? dec(m[1]) : null; };
  // <b/>, <b val="1"/>, <b val="true"/> are bold; <b val="0"/> is not.
  // Also bold: a font *named* bold, e.g. "Arial Bold" / "Calibri Bold" (used in the TL sheets).
  const isBoldTag = (xml) => {
    const m = xml.match(/<(?:\w+:)?b(\s[^>]*)?\/?>/);
    if (m && !/val="(0|false)"/.test(m[1] || '')) return true;
    const n = xml.match(/<(?:\w+:)?(?:name|rFont)\s+val="([^"]*)"/);
    return !!n && /\b(bold|black|heavy)\b/i.test(n[1]);
  };
  const section = (xml, tag) => { const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`)); return m ? m[1] : ''; };

  function text(zip, path) {
    const want = '/' + path.toLowerCase();
    const i = zip.FullPaths.findIndex((p) => p.toLowerCase().endsWith(want));
    if (i < 0) return '';
    const c = zip.FileIndex[i].content;
    if (!c) return '';
    return new TextDecoder().decode(c instanceof Uint8Array ? c : Uint8Array.from(c));
  }

  /** { sheetName: Set("K6", "K12", …) } for the requested sheets. Returns null if it can't tell. */
  function boldCells(buf, sheetNames) {
    const XLSX = global.XLSX;
    const zip = XLSX.CFB.read(buf instanceof Uint8Array ? buf : new Uint8Array(buf), { type: 'array' });

    // Fonts → bold?   cellXfs (cell styles) → font
    const styles = text(zip, 'xl/styles.xml');
    if (!styles) return null;
    const fonts = [...section(styles, 'fonts').matchAll(/<(?:\w+:)?font\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?font>)/g)].map((m) => isBoldTag(m[1] || ''));
    const xfBold = [...section(styles, 'cellXfs').matchAll(/<(?:\w+:)?xf\b([^>]*?)\/?>/g)].map((m) => !!fonts[+(attr(m[1], 'fontId') || 0)]);

    // Shared strings: bold if any formatted run inside is bold.
    const sst = [...text(zip, 'xl/sharedStrings.xml').matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)]
      .map((m) => [...m[1].matchAll(/<(?:\w+:)?rPr>([\s\S]*?)<\/(?:\w+:)?rPr>/g)].some((r) => isBoldTag(r[1])));

    // Sheet name → worksheet file.
    const rels = {};
    for (const m of text(zip, 'xl/_rels/workbook.xml.rels').matchAll(/<(?:\w+:)?Relationship\b([^>]*?)\/?>/g)) rels[attr(m[1], 'Id')] = attr(m[1], 'Target');
    const sheetPath = {};
    for (const m of text(zip, 'xl/workbook.xml').matchAll(/<(?:\w+:)?sheet\b([^>]*?)\/?>/g)) {
      const target = rels[attr(m[1], 'id')];
      if (target) sheetPath[attr(m[1], 'name')] = target.replace(/^\/?(xl\/)?/, 'xl/');
    }

    const out = {};
    for (const name of sheetNames) {
      const xml = sheetPath[name] && text(zip, sheetPath[name]);
      if (!xml) continue;
      const set = new Set();
      for (const m of xml.matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
        const ref = attr(m[1], 'r');
        if (!ref) continue;
        let bold = xfBold[+(attr(m[1], 's') || 0)];
        if (!bold && attr(m[1], 't') === 's') {
          const v = (m[2] || '').match(/<(?:\w+:)?v>(\d+)</);
          if (v && sst[+v[1]]) bold = true;
        }
        if (!bold && attr(m[1], 't') === 'inlineStr' && /<(?:\w+:)?rPr>/.test(m[2] || '')) bold = isBoldTag(m[2]);
        if (bold) set.add(ref);
      }
      out[name] = set;
    }
    return out;
  }

  global.CrownXFmt = { boldCells };
})(typeof window !== 'undefined' ? window : globalThis);
