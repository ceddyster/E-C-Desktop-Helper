/* Linked folder: the dashboard remembers a folder on this computer (e.g. a SharePoint library
 * synced to File Explorer) and picks up new or changed TL Sheets and BEOs from it.
 * Uses the File System Access API (Edge / Chrome). The folder handle is kept in IndexedDB;
 * nothing leaves the computer. */
(function (global) {
  'use strict';
  const DB = 'crownDash', STORE = 'handles', KEY = 'folder';
  const WANT = /\.(xlsx|xlsm|xls|pdf|ics)$/i;
  const MAX_DEPTH = 3;

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

  /** Lists TL/BEO-type files (sub-folders up to 3 deep). Skips Office lock files (~$…). */
  async function list(h, prefix = '', depth = 0, out = []) {
    for await (const [name, entry] of h.entries()) {
      if (name.startsWith('~$') || name.startsWith('.')) continue;
      if (entry.kind === 'directory') {
        if (depth < MAX_DEPTH) await list(entry, `${prefix}${name}/`, depth + 1, out);
      } else if (WANT.test(name)) {
        try {
          const file = await entry.getFile();
          out.push({ path: prefix + name, name, lastModified: file.lastModified, file });
        } catch (_) { /* cloud-only file that couldn't be fetched right now; try next scan */ }
      }
    }
    return out;
  }

  global.CrownFolder = { supported, pick, remember, saved, forget, permission, list };
})(window);
