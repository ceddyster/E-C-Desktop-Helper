/* Makes big Excel files quick to read.
 *
 * An .xlsx/.xlsm file is a zip. Some workbooks (e.g. the banquet consumption ones) carry tens of MB of
 * drawings, buttons and macros, and the spreadsheet library unpacks all of it, which can take a minute.
 * This keeps only what's needed to read cell values and formatting, unpacks it with the browser's
 * built-in decompressor, and hands the library a small uncompressed zip instead.
 * The file on disk is never changed. If anything is unusual, the original bytes are used. */
(function (global) {
  'use strict';
  const DROP = /^(xl\/drawings\/|xl\/media\/|xl\/vbaProject|xl\/printerSettings\/|xl\/ctrlProps\/|xl\/activeX\/|xl\/embeddings\/|xl\/diagrams\/|xl\/charts\/|docProps\/thumbnail|customXml\/)/i;

  let crcTable = null;
  function crc32(u8) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
    }
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  async function inflate(data) {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** Builds an uncompressed ("stored") zip from [{ name, data }]. */
  function storeZip(files) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      const local = new Uint8Array(30 + name.length); const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(8, 0, true);
      lv.setUint32(14, crc, true); lv.setUint32(18, size, true); lv.setUint32(22, size, true); lv.setUint16(26, name.length, true);
      local.set(name, 30);
      const cd = new Uint8Array(46 + name.length); const cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint32(16, crc, true); cv.setUint32(20, size, true); cv.setUint32(24, size, true); cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true); cd.set(name, 46);
      parts.push(local, f.data); central.push(cd);
      offset += local.length + size;
    }
    const cdSize = central.reduce((a, c) => a + c.length, 0);
    const end = new Uint8Array(22); const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
    const out = new Uint8Array(offset + cdSize + 22); let p = 0;
    for (const x of [...parts, ...central, end]) { out.set(x, p); p += x.length; }
    return out.buffer;
  }

  /** Returns a smaller ArrayBuffer to read, or the original if there's nothing to gain (or it can't). */
  async function slim(buf) {
    try {
      if (typeof DecompressionStream === 'undefined') return buf;
      const u8 = new Uint8Array(buf); const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      if (dv.getUint32(0, true) !== 0x04034b50) return buf;                 // not a zip (e.g. old .xls)
      let eocd = -1;
      for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
      if (eocd < 0) return buf;
      const count = dv.getUint16(eocd + 10, true);
      let p = dv.getUint32(eocd + 16, true);
      const keep = []; let dropped = 0;
      for (let k = 0; k < count; k++) {
        if (dv.getUint32(p, true) !== 0x02014b50) return buf;
        const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
        const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), loff = dv.getUint32(p + 42, true);
        const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
        p += 46 + nlen + elen + clen;
        if (DROP.test(name)) { dropped += usize; continue; }
        if (method !== 0 && method !== 8) return buf;
        keep.push({ name, method, csize, loff });
      }
      if (dropped < 2e6) return buf;                                         // small file: read it as it is
      const files = [];
      for (const f of keep) {
        const start = f.loff + 30 + dv.getUint16(f.loff + 26, true) + dv.getUint16(f.loff + 28, true);
        const data = u8.subarray(start, start + f.csize);
        files.push({ name: f.name, data: f.method === 0 ? data : await inflate(data) });
      }
      return storeZip(files);
    } catch (e) {
      console.warn('Reading the full workbook (couldn\'t slim it):', e);
      return buf;
    }
  }

  global.CrownSlim = { slim };
})(typeof window !== 'undefined' ? window : globalThis);
