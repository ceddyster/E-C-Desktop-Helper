/* Optional Google Drive Picker. Only active when config.js has credentials.
 * Uses the drive.file scope: the page can only read files you pick. */
(function (global) {
  'use strict';
  const cfg = global.CROWN_CONFIG || {};
  const enabled = !!(cfg.googleApiKey && cfg.googleClientId && cfg.googleAppId);
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const EXPORTS = {
    'application/vnd.google-apps.spreadsheet': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
  };

  let token = null, tokenClient = null, pickerReady = null;

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.async = true; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }

  function init() {
    if (pickerReady) return pickerReady;
    pickerReady = Promise.all([
      loadScript('https://apis.google.com/js/api.js').then(() => new Promise((r) => global.gapi.load('picker', r))),
      loadScript('https://accounts.google.com/gsi/client'),
    ]);
    return pickerReady;
  }

  function getToken() {
    return new Promise((resolve, reject) => {
      if (!tokenClient) {
        tokenClient = global.google.accounts.oauth2.initTokenClient({ client_id: cfg.googleClientId, scope: SCOPE, callback: () => {} });
      }
      tokenClient.callback = (resp) => {
        if (resp.error) return reject(new Error(resp.error));
        token = resp.access_token; resolve(token);
      };
      tokenClient.error_callback = (e) => reject(new Error(e && e.message || 'Sign-in cancelled'));
      tokenClient.requestAccessToken({ prompt: token ? '' : 'consent' });
    });
  }

  async function download(doc) {
    const exp = EXPORTS[doc.mimeType];
    const url = exp
      ? `https://www.googleapis.com/drive/v3/files/${doc.id}/export?mimeType=${encodeURIComponent(exp[0])}`
      : `https://www.googleapis.com/drive/v3/files/${doc.id}?alt=media&supportsAllDrives=true`;
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error(`${doc.name}: Drive returned ${r.status}`);
    const name = exp && !doc.name.toLowerCase().endsWith(exp[1]) ? doc.name + exp[1] : doc.name;
    return { name, buf: await r.arrayBuffer() };
  }

  /** Opens the picker; resolves to [{name, buf}] (empty if cancelled). */
  async function pick() {
    await init();
    await getToken();
    const g = global.google.picker;
    return new Promise((resolve, reject) => {
      const view = new g.DocsView(g.ViewId.DOCS)
        .setIncludeFolders(true)
        .setMimeTypes([
          'application/vnd.google-apps.spreadsheet',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel', 'text/csv', 'text/calendar', 'application/json',
        ].join(','));
      const shared = new g.DocsView(g.ViewId.DOCS).setEnableDrives(true).setIncludeFolders(true);
      const picker = new g.PickerBuilder()
        .addView(view).addView(shared)
        .enableFeature(g.Feature.MULTISELECT_ENABLED)
        .enableFeature(g.Feature.SUPPORT_DRIVES)
        .setOAuthToken(token).setDeveloperKey(cfg.googleApiKey).setAppId(cfg.googleAppId)
        .setTitle('Pick your Crown documents')
        .setCallback(async (data) => {
          if (data.action === g.Action.CANCEL) return resolve([]);
          if (data.action !== g.Action.PICKED) return;
          try { resolve(await Promise.all(data.docs.map(download))); } catch (e) { reject(e); }
        })
        .build();
      picker.setVisible(true);
    });
  }

  global.CrownDrive = { enabled, pick };
})(window);
