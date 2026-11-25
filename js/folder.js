/* Linked folders: the dashboard remembers folders on this computer (e.g. a SharePoint library
 * synced to File Explorer) and picks up new or changed TL Sheets and BEOs from it.
 * Uses the File System Access API (Edge / Chrome). The folder handle is kept in IndexedDB;
 * nothing leaves the computer. */
(function (global) {
  'use strict';
  const DB = 'crownDash', STORE = 'handles', KEY = 'folder';
  const WANT = /\.(xlsx|xlsm|xlsb|xls|pdf|ics|url)$/i;
  const MAX_DEPTH = 6;

  // The browser's store for folder handles. If it can't be opened (damaged, or missing its table), it's
  // repaired; failing that, a fresh store is used. The last problem is kept in lastError for Documents.
  // Which store to use: normally 'crownDash'; 'crownDashFolders' once the first has stopped working.
  const PICK = 'crownDash.folderStore';
  let dbName = DB;
  try { dbName = localStorage.getItem(PICK) || DB; } catch (_) {}
  const useStore = (name) => { dbName = name; try { if (name === DB) localStorage.removeItem(PICK); else localStorage.setItem(PICK, name); } catch (_) {} };
  let lastError = null, dbPromise = null, dbOpen = null;
  const errText = (e) => (e && (e.message || e.name)) || String(e);
  // The browser can stop answering (a stuck or damaged store): give up after a few seconds rather than wait forever.
  const within = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what)), ms))]);
  function openDb(name, version) {
    return new Promise((res, rej) => {
      const r = version ? indexedDB.open(name, version) : indexedDB.open(name);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
      r.onsuccess = () => {
        const db = r.result;
        if (db.objectStoreNames.contains(STORE)) return res(db);
        // Opened, but without the folders table: add it.
        const v = db.version + 1; db.close();
        openDb(name, v).then(res, rej);
      };
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('the folder store is in use by another dashboard tab; close the other tabs and reload'));
    });
  }
  const dropDb = (name) => new Promise((res) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = r.onerror = r.onblocked = () => res(); });
  function idb() {
    if (!dbPromise) {
      dbPromise = within(open0(), 6000, 'the browser didn\'t answer when the dashboard opened its list of linked folders');
      dbPromise.then((db) => { dbOpen = db; }, (e) => {
        lastError = `Couldn't open the browser's store of linked folders (${errText(e)}).`; console.warn(lastError); dbPromise = null;
        if (dbName === DB) useStore(DB + 'Folders');      // next time, use a fresh store
      });
    }
    return dbPromise;
  }
  async function open0() {
    try { return await openDb(dbName); } catch (e) {
      lastError = `Couldn't open the browser's store of linked folders (${errText(e)}).`;
      console.warn(lastError);
      try { await dropDb(dbName); return await openDb(dbName); } catch (_) {}
      useStore(DB + 'Folders');
      return openDb(dbName);
    }
  }
  /** "123 MB used of 2,000 MB" for this site's browser storage, or '' if the browser won't say. */
  async function usage() {
    try {
      const e = await within(navigator.storage.estimate(), 3000, 'no answer');
      const mb = (b) => Math.round(b / 1048576).toLocaleString('en-AU');
      return `${mb(e.usage)} MB used of ${mb(e.quota)} MB (${Math.round((e.usage / e.quota) * 100)}%)`;
    } catch (_) { return ''; }
  }
  /** Can the browser save at all for this site? Saves and removes a small plain value. */
  async function writeTest() {
    try { await tx('readwrite', (st) => st.put({ at: Date.now() }, '__test')); await tx('readwrite', (st) => st.delete('__test')); return 'the browser can save plain data here, so only saving folder links is failing.'; }
    catch (e) { return `the browser can't save anything here (${errText(e)}).`; }
  }
  /** Starts the store again from empty (the folders then need linking again). */
  async function reset() {
    try { if (dbOpen) dbOpen.close(); } catch (_) {}
    dbOpen = null; dbPromise = null;
    await within(Promise.all([dropDb(DB), dropDb(DB + 'Folders')]), 6000, 'the browser didn\'t answer').catch((e) => { lastError = `Couldn't reset the store of linked folders (${errText(e)}). Close every dashboard tab, then open it again.`; throw new Error(lastError); });
    useStore(DB); lastError = null;
  }
  async function tx(mode, fn) {
    const db = await idb();
    return within(new Promise((res, rej) => {
      let t;
      try { t = db.transaction(STORE, mode); } catch (e) { dbPromise = null; return rej(e); }
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('the browser stopped saving'));
    }), 6000, 'the browser didn\'t answer when asked for the linked folders').catch((e) => {
      lastError = lastError || (/blob|quota|space|disk/i.test(errText(e))
        ? `The browser couldn't save to its storage for this site (${errText(e)}). Its storage may be full, or blocked on this computer.`
        : `The browser's store of linked folders isn't working (${errText(e)}).`);
      dbPromise = null;
      throw e;
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
  // A folder the browser has lost track of (e.g. a OneDrive folder that has moved) can leave these
  // questions unanswered, so each has a time limit.
  async function permission(h, ask) {
    if (!h.queryPermission) return 'granted';
    let p = await within(h.queryPermission({ mode: 'read' }), 4000, 'the browser didn\'t answer about this folder');
    if (p !== 'granted' && ask) p = await within(h.requestPermission({ mode: 'read' }), 120000, 'no answer to the permission request');
    return p;
  }

  /** Lists TL/BEO-type files (sub-folders up to 6 deep). Skips Office lock files (~$…). */
  // opts.before ('YYYY-MM-DD'): skip sub-folders whose name says they only hold older material
  // (e.g. "2024", "FY24", "2023-24", "June 2025" when keeping from 1 July 2025). Their names go in out.skippedDirs.
  async function list(h, prefix = '', depth = 0, out = [], opts = {}) {
    if (!out.skippedDirs) out.skippedDirs = [];
    const files = [], dirs = [];
    for await (const [name, entry] of h.entries()) {
      if (name.startsWith('~$') || name.startsWith('.')) continue;
      if (entry.kind === 'directory') {
        const end = opts.before ? periodEnd(`${prefix}${name}`) : null;
        if (end && end < opts.before) { out.skippedDirs.push(prefix + name); continue; }
        if (depth < MAX_DEPTH) dirs.push([name, entry]);
      } else if (WANT.test(name)) files.push([name, entry]);
    }
    // Asking for each file's saved time is the slow part (more so for OneDrive files), so ask for
    // up to 16 at once. Only the saved time is looked at here; a file's contents are read later,
    // and only if it's new or has changed.
    for (let i = 0; i < files.length; i += 16) {
      out.push(...await Promise.all(files.slice(i, i + 16).map(async ([name, entry]) => {
        try {
          const file = await entry.getFile();
          const item = { path: prefix + name, name, lastModified: file.lastModified, file };
          if (/\.url$/i.test(name)) item.target = shortcutTarget(await file.text());
          return item;
        } catch (e) {
          // Usually a cloud-only file OneDrive couldn't fetch right now. Reported, and tried again next check.
          return { path: prefix + name, name, error: e.message || String(e) };
        }
      })));
    }
    for (const [name, entry] of dirs) await list(entry, `${prefix}${name}/`, depth + 1, out, opts);
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
    try { items = await tx('readonly', (st) => st.get(LIST)); } catch (e) { lastError = `Couldn't read the linked folders (${errText(e)}).`; console.warn(lastError); return null; }
    if ((!items || !items.length) && dbName !== DB) {
      // The fresh store is empty: the folders may still be in the usual one.
      const was = dbName; useStore(DB); try { if (dbOpen) dbOpen.close(); } catch (_) {} dbOpen = null; dbPromise = null;
      try { const old = await tx('readonly', (st) => st.get(LIST)); if (old && old.length) return old; } catch (_) {}
      useStore(was); try { if (dbOpen) dbOpen.close(); } catch (_) {} dbOpen = null; dbPromise = null;
    }
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
    // If the saved list can't be read, don't overwrite it with just this folder.
    let items = await savedAll();
    if (items == null && dbName !== DB) items = await savedAll();   // the usual store failed: try the fresh one
    if (items == null) throw new Error(lastError || 'couldn\'t read the linked folders');
    for (const it of items) {
      try { if (it.id !== replaceId && await within(it.handle.isSameEntry(handle), 3000, 'no answer')) return { id: it.id, existed: true }; } catch (_) {}
    }
    const id = replaceId || 'f' + Date.now().toString(36);
    const next = replaceId && items.some((it) => it.id === replaceId) ? items.map((it) => (it.id === replaceId ? { id, handle } : it)) : [...items, { id, handle }];
    await storeAll(next);
    return { id, existed: false };
  }
  async function remove(id) { const items = await savedAll(); if (items == null) throw new Error(lastError); await storeAll(items.filter((it) => it.id !== id)); }

  global.CrownFolder = { periodEnd, shortcutTarget, sharePointSite, supported, pick, remember, saved, forget, permission, list,
    savedAll, choose, add, remove, reset, within, usage, writeTest, get lastError() { return lastError; }, get storeName() { return dbName; } };
})(window);
