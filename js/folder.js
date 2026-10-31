/* Linked folder: the dashboard remembers a folder on this computer (e.g. a SharePoint library
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
  async function list(h, prefix = '', depth = 0, out = []) {
    for await (const [name, entry] of h.entries()) {
      if (name.startsWith('~$') || name.startsWith('.')) continue;
      if (entry.kind === 'directory') {
        if (depth < MAX_DEPTH) await list(entry, `${prefix}${name}/`, depth + 1, out);
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

  global.CrownFolder = { shortcutTarget, sharePointSite, supported, pick, remember, saved, forget, permission, list };
})(window);
