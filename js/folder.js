/* Linked folders: the dashboard remembers folders on this computer (e.g. a SharePoint library
 * synced to File Explorer) and picks up new or changed TL Sheets and BEOs from it.
 * Uses the File System Access API (Edge / Chrome). The folder handle is kept in IndexedDB;
 * nothing leaves the computer. */
(function (global) {
  'use strict';
  const DB = 'crownDash', STORE = 'handles', KEY = 'folder';
  const WANT = /\.(xlsx|xlsm|xlsb|xls|pdf|ics|url)$/i;
  const MAX_DEPTH = 6;

  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function tx(mode, fn) {
    const db = await idb();
    return new Promise((res, rej) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
    });
  }

  const supported = typeof global.showDirectoryPicker === 'function';

  async function pick() {
    const h = await global.showDirectoryPicker({ id: 'crown-docs', mode: 'read' });
    await remember(h);
    return h;
  }
  const remember = (h) => tx('readwrite', (s) => s.put(h, KEY));
  async function saved() { try { return (await tx('readonly', (s) => s.get(KEY))) || null; } catch (_) { return null; } }
  async function forget() { try { await tx('readwrite', (s) => s.delete(KEY)); } catch (_) {} }

  /** 'granted' | 'prompt' | 'denied'. Asking needs a click from the user. */
  async function permission(h, ask) {
    if (!h.queryPermission) return 'granted';
    let p = await h.queryPermission({ mode: 'read' });
    if (p !== 'granted' && ask) p = await h.requestPermission({ mode: 'read' });
    return p;
  }

  /** Lists TL/BEO-type files (sub-folders up to 6 deep). Skips Office lock files (~$…). */
  // opts.before ('YYYY-MM-DD'): skip sub-folders whose name says they only hold older material
  // (e.g. "2024", "FY24", "2023-24", "June 2025" when keeping from 1 July 2025). Their names go in out.skippedDirs.
  async function list(h, prefix = '', depth = 0, out = [], opts = {}) {
    if (!out.skippedDirs) out.skippedDirs = [];
    for await (const [name, entry] of h.entries()) {
      if (name.startsWith('~$') || name.startsWith('.')) continue;
      if (entry.kind === 'directory') {
        const end = opts.before ? periodEnd(`${prefix}${name}`) : null;
        if (end && end < opts.before) { out.skippedDirs.push(prefix + name); continue; }
        if (depth < MAX_DEPTH) await list(entry, `${prefix}${name}/`, depth + 1, out, opts);
      } else if (WANT.test(name)) {
        try {
          const file = await entry.getFile();
          const item = { path: prefix + name, name, lastModified: file.lastModified, file };
          if (/\.url$/i.test(name)) item.target = shortcutTarget(await file.text());
          out.push(item);
        } catch (e) {
          // Usually a cloud-only file OneDrive couldn't fetch right now. Reported, and tried again next check.
          out.push({ path: prefix + name, name, error: e.message || String(e) });
        }
      }
    }
    return out;
  }

  /** The last day a folder path clearly covers, from its folder names, or null if it doesn't say.
   *  "2024" → 2024-12-31 · "FY24" / "FY 2023-24" / "2023-2024" → 2024-06-30 · "2025/June" or "June 2025" → 2025-06-30. */
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  function periodEnd(path) {
    let year = null, month = null, fyEnd = null;
    const y4 = (n) => (+n < 100 ? 2000 + +n : +n);
    for (const part of String(path).split('/').filter(Boolean)) {
      const p = part.toLowerCase();
      let m;
      if ((m = p.match(/\bfy\s*'?(\d{2}|\d{4})\s*[-\/–]\s*(\d{2}|\d{4})\b/)) || (m = p.match(/\b(20\d{2})\s*[-\/–]\s*(\d{2}|20\d{2})\b/))) {
        const a = y4(m[1]), b = y4(m[2]);
        if (b === a + 1) fyEnd = b;                                    // "2023-24": a financial year
        else if (+m[2] >= 1 && +m[2] <= 12 && m[2].length <= 2) { year = a; month = +m[2] - 1; }   // "2025-06": year-month
      } else if ((m = p.match(/\bfy\s*'?(\d{2}|20\d{2})\b/))) {
        fyEnd = y4(m[1]);
      } else if ((m = p.match(/\b(20\d{2})\b/))) {
        year = +m[1];
      }
      const mi = MONTHS.findIndex((mn) => new RegExp(`(^|[^a-z])${mn}`).test(p));
      if (mi >= 0) month = mi;
      // A numbered month folder inside a year folder: "2025/07" or "2025/07 - July".
      else if ((year != null || fyEnd) && month == null && (m = p.match(/^\s*(\d{1,2})(?!\d)/)) && +m[1] >= 1 && +m[1] <= 12) month = +m[1] - 1;
    }
    const last = (y, mo) => { const d = new Date(y, mo + 1, 0); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    if (fyEnd) return month != null ? last(month >= 6 ? fyEnd - 1 : fyEnd, month) : `${fyEnd}-06-30`;
    if (year != null) return month != null ? last(year, month) : `${year}-12-31`;
    return null;
  }

  /** Windows internet shortcut → its web address. */
  function shortcutTarget(text) {
    const m = String(text).match(/^URL=(\S+)/mi);
    return m ? m[1].trim() : '';
  }

  /** "https://x.sharepoint.com/sites/Team/_layouts/…" → "https://x.sharepoint.com/sites/Team" */
  function sharePointSite(url) {
    try {
      const u = new URL(url);
      if (!/\.sharepoint\.com$/i.test(u.hostname)) return '';
      const m = u.pathname.match(/\/(sites|teams)\/[^/]+/i);   // also inside "/:x:/r/sites/…" links
      return u.origin + (m ? m[0] : '');
    } catch (_) { return ''; }
  }

  /* Several linked folders, kept as [{ id, handle }]. The original single folder (key 'folder')
   * is moved into the list the first time. */
  const LIST = 'folders';
  async function savedAll() {
    let items = null;
    try { items = await tx('readonly', (st) => st.get(LIST)); } catch (_) { return []; }
    if (!items || !items.length) {
      const old = await saved();
      items = old ? [{ id: 'f1', handle: old }] : (items || []);
      try { await tx('readwrite', (st) => st.put(items, LIST)); if (old) await forget(); } catch (_) {}
    }
    return items;
  }
  const storeAll = (items) => tx('readwrite', (st) => st.put(items, LIST));

  /** Asks for a folder. Doesn't store it. */
  const choose = () => global.showDirectoryPicker({ id: 'crown-docs', mode: 'read' });

  /** Adds a folder (or replaces `replaceId`). Returns { id, existed }. */
  async function add(handle, replaceId) {
    const items = await savedAll();
    for (const it of items) {
      try { if (it.id !== replaceId && await it.handle.isSameEntry(handle)) return { id: it.id, existed: true }; } catch (_) {}
    }
    const id = replaceId || 'f' + Date.now().toString(36);
    const next = replaceId ? items.map((it) => (it.id === replaceId ? { id, handle } : it)) : [...items, { id, handle }];
    await storeAll(next);
    return { id, existed: false };
  }
  async function remove(id) { await storeAll((await savedAll()).filter((it) => it.id !== id)); }

  global.CrownFolder = { periodEnd, shortcutTarget, sharePointSite, supported, pick, remember, saved, forget, permission, list,
    savedAll, choose, add, remove };
})(window);
