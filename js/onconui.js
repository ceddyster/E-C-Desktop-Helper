/* On-consumption sheets add-on: a printable check-off sheet for an event's bar(s), laid out like the
 * ON CONSUMPTION form (Event Name / Event Date / Bar Location / On consumption time, then Product |
 * Consumption, then "Entered By"). Items come from the event's BEO ("Beverages on consumption"),
 * named as on the Banquet Menu, and can be added or removed by hand. Nothing is priced.
 *
 * Banquet Menus (from the linked folder) are kept in this browser: { id: { title, file, items: [{ name, cat }] } }.
 * Sheets being worked on are kept as drafts, one per event. */
(function (global) {
  'use strict';
  const MENU_KEY = 'crownDash.menus', DRAFT_KEY = 'crownDash.onconDrafts';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const todayISO = () => isoOf(new Date());
  const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return isoOf(d); };
  const fmtShort = (iso) => (iso ? parseISO(iso).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : '');
  const fmtLong = (iso) => (iso ? parseISO(iso).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '');
  const t12 = (t) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${pad(m)}${h < 12 || h === 24 ? 'am' : 'pm'}`; };
  const M = () => global.CrownMenu;

  let menus = {}, drafts = {}, opts = {};
  let cur = null;          // the sheet open in the panel: { key, eventId, name, date, bars, from, to, perBar, blanks, items: [{ id, name, cat }] }
  try { menus = JSON.parse(localStorage.getItem(MENU_KEY)) || {}; } catch (_) {}
  try { drafts = JSON.parse(localStorage.getItem(DRAFT_KEY)) || {}; } catch (_) {}
  const storeMenus = () => { try { localStorage.setItem(MENU_KEY, JSON.stringify(menus)); } catch (_) {} };
  const storeDrafts = () => {
    // Keep the 60 most recent drafts.
    const keys = Object.keys(drafts).sort((a, b) => (drafts[b].savedAt || '').localeCompare(drafts[a].savedAt || ''));
    for (const k of keys.slice(60)) delete drafts[k];
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts)); } catch (_) {}
  };

  /* ---------- Menus ---------- */
  function addMenu(id, data) { menus[id] = data; storeMenus(); render(); }
  function removeMenu(id) { if (menus[id]) { delete menus[id]; storeMenus(); render(); } }
  function clearMenus() { menus = {}; storeMenus(); render(); }
  const menuIds = () => Object.keys(menus);
  /** Every beverage item on the linked menus (first one wins for a repeated name). */
  function menuItems() {
    const seen = new Set(), out = [];
    for (const m of Object.values(menus)) for (const it of m.items) { const k = it.name.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(it); } }
    return out;
  }

  /* ---------- Events ---------- */
  const evKey = (e) => `${e.date}|${e.beo && e.beo.number ? 'beo' + e.beo.number : e.title.toLowerCase()}`;
  /** Events from today on (for the picker / window), with what their BEO says about on-consumption. */
  function upcoming(days) {
    const out = [];
    for (let i = 0; i < days; i++) {
      const iso = addDays(todayISO(), i);
      for (const e of (opts.events ? opts.events(iso) : [])) {
        if (e.setup) continue;
        const on = M() && e.beo ? M().fromBEO(e.beo.beverage) : { items: [] };
        out.push({ e, key: evKey(e), on });
      }
    }
    return out;
  }

  /** A fresh sheet for an event: details from the event, items from its BEO, named as on the menu. */
  function fromEvent(x) {
    const e = x.e, menu = menuItems();
    const items = [], seen = new Set();
    for (const it of x.on.items) {
      const m = menu.length ? M().bestMatch(it.name, menu) : null;
      const name = m ? m.name : it.name, k = name.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      items.push({ id: uid(), name, cat: m ? m.cat : it.cat });
    }
    return { key: x.key, eventId: e.id, name: e.title, date: e.date, bars: (e.bars || []).join(', ') || e.venue || '',
      from: x.on.from || e.start || '', to: x.on.to || '', perBar: false, blanks: 3, items };
  }
  const blank = () => ({ key: 'new', eventId: '', name: '', date: todayISO(), bars: '', from: '', to: '', perBar: false, blanks: 3, items: [] });
  let n = 0;
  const uid = () => 'i' + Date.now().toString(36) + (n++);

  /* ---------- The printed sheet ---------- */
  function sheetHtml(s, bar) {
    const cats = M() ? M().CATS : ['Other'];
    const groups = cats.map((c) => [c, s.items.filter((i) => i.cat === c)]).filter(([, l]) => l.length);
    const other = s.items.filter((i) => !cats.includes(i.cat));
    if (other.length) groups.push(['Other', other]);
    const time = s.from ? `${t12(s.from)} – ${s.to ? t12(s.to) : ''}` : '';
    const rows = s.items.length + groups.length + (+s.blanks || 0);
    return `<section class="oc-sheet${rows > 30 ? ' compact' : ''}">
      <table class="oc-head"><tbody>
        <tr><th>Event Name</th><td>${esc(s.name)}</td></tr>
        <tr><th>Event Date</th><td>${esc(fmtLong(s.date))}</td></tr>
        <tr><th>Bar Location</th><td>${esc(bar)}</td></tr>
        <tr><th>On consumption</th><td>${esc(time)}</td></tr>
      </tbody></table>
      <table class="oc-items"><thead><tr><th>Product</th><th class="c">Consumption</th></tr></thead>
        <tbody>${groups.map(([c, list]) => `<tr class="oc-grp"><td colspan="2">${esc(c)}</td></tr>${list.map((i) => `<tr><td>${esc(i.name)}</td><td class="c"></td></tr>`).join('')}`).join('')}
        ${Array.from({ length: +s.blanks || 0 }, () => '<tr class="oc-blank"><td>&nbsp;</td><td class="c"></td></tr>').join('')}</tbody></table>
      <table class="oc-foot"><tbody><tr><th>Entered By:</th><td></td><th>Checked By:</th><td></td></tr></tbody></table>
    </section>`;
  }
  const barsOf = (s) => (s.perBar ? s.bars.split(/\s*[,;\n]\s*/).map((b) => b.trim()).filter(Boolean) : [s.bars.trim()]);
  const sheetsHtml = (s) => (barsOf(s).length ? barsOf(s) : ['']).map((b) => sheetHtml(s, b)).join('');

  function print() {
    if (!cur) return;
    if (!cur.items.length && !confirm('There are no items on this sheet. Print it anyway?')) return;
    let area = $('ocPrint');
    if (!area) { area = document.createElement('div'); area.id = 'ocPrint'; document.body.appendChild(area); }
    area.innerHTML = sheetsHtml(cur);
    cur.printedAt = new Date().toISOString(); save();
    document.body.classList.add('printing-oc');
    const done = () => { document.body.classList.remove('printing-oc'); global.removeEventListener('afterprint', done); renderWin(); };
    global.addEventListener('afterprint', done);
    global.print();
    setTimeout(done, 1000);   // some browsers don't send afterprint
  }

  /* ---------- Window ---------- */
  function renderWin() {
    const body = $('ocWinList'); if (!body) return;
    const list = upcoming(2);
    const withOn = list.filter((x) => x.on.items.length);
    $('ocWinSub').textContent = `${menuItems().length ? `${menuItems().length} menu items` : 'No Banquet Menu linked yet'}`;
    if (!list.length) { body.innerHTML = '<li class="win-empty">No events today or tomorrow. Click to make a sheet.</li>'; return; }
    const show = withOn.length ? withOn : list;
    body.innerHTML = (withOn.length ? '' : '<li class="win-empty">No beverages on consumption on today\'s or tomorrow\'s BEOs.</li>')
      + show.slice(0, 6).map((x) => { const d = drafts[x.key];
        return `<li class="oc-li" data-oc-event="${esc(x.key)}"><div class="win-ev"><span>${esc(x.e.title)}</span><span class="t">${esc(x.e.date === todayISO() ? 'Today' : 'Tomorrow')}${x.on.from ? ' · ' + esc(t12(x.on.from)) : ''}</span></div>
          <div class="mgr-evs">${x.on.items.length ? `${x.on.items.length} item${x.on.items.length === 1 ? '' : 's'} on consumption` : 'nothing on consumption on the BEO'}${d && d.printedAt ? ` · <span class="oc-printed">✓ printed</span>` : d ? ' · draft saved' : ''}</div></li>`; }).join('');
  }

  /* ---------- Panel ---------- */
  function save() { if (!cur) return; cur.savedAt = new Date().toISOString(); drafts[cur.key] = JSON.parse(JSON.stringify(cur)); storeDrafts(); }

  function load(key) {
    const list = upcoming(14);
    if (key === 'new') cur = drafts.new ? JSON.parse(JSON.stringify(drafts.new)) : blank();
    else if (drafts[key]) cur = JSON.parse(JSON.stringify(drafts[key]));
    else { const x = list.find((y) => y.key === key); cur = x ? fromEvent(x) : blank(); }
    renderPanel();
  }

  function renderPanel() {
    const dlg = $('ocDlg'); if (!dlg || !dlg.open || !cur) return;
    const list = upcoming(14);
    $('ocEvent').innerHTML = '<option value="new">New sheet (not linked to an event)</option>'
      + list.map((x) => `<option value="${esc(x.key)}" ${x.key === cur.key ? 'selected' : ''}>${esc(fmtShort(x.e.date))} · ${esc(x.e.title)}${x.on.items.length ? ` (${x.on.items.length} on consumption)` : ''}</option>`).join('')
      + (cur.key !== 'new' && !list.some((x) => x.key === cur.key) ? `<option value="${esc(cur.key)}" selected>${esc(fmtShort(cur.date))} · ${esc(cur.name)}</option>` : '');
    if (cur.key === 'new') $('ocEvent').value = 'new';
    $('ocName').value = cur.name; $('ocDate').value = cur.date; $('ocBars').value = cur.bars;
    $('ocFrom').value = cur.from; $('ocTo').value = cur.to; $('ocPerBar').checked = !!cur.perBar; $('ocBlanks').value = cur.blanks;
    const menu = menuItems();
    $('ocMenuNote').innerHTML = menu.length
      ? `Item names are matched to the Banquet Menu (${menu.length} items from ${Object.values(menus).map((m) => esc(m.title)).join(', ')}).`
      : 'No Banquet Menu linked yet, so item names are as written on the BEO. Link the Banquet Menu folder in 📁 Documents to match them to the menu.';
    $('ocMenuList').innerHTML = menu.map((i) => `<option value="${esc(i.name)}">${esc(i.cat)}</option>`).join('');
    const cats = M().CATS;
    $('ocAddCat').innerHTML = cats.map((c) => `<option>${esc(c)}</option>`).join('');
    const ev = list.find((x) => x.key === cur.key);
    $('ocReset').hidden = !ev;
    $('ocItems').innerHTML = cur.items.length ? cats.map((c) => [c, cur.items.filter((i) => i.cat === c)]).filter(([, l]) => l.length).map(([c, l]) => `<li class="oc-cat">${esc(c)}</li>${l.map((i) => `
        <li class="oc-row"><input type="text" value="${esc(i.name)}" data-oc-name="${esc(i.id)}" aria-label="Item name" list="ocMenuList">
          <select data-oc-cat="${esc(i.id)}" aria-label="Section">${cats.map((k) => `<option ${k === i.cat ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select>
          <button type="button" class="btn ghost sm" data-oc-del="${esc(i.id)}" aria-label="Remove ${esc(i.name)}" title="Remove">✕</button></li>`).join('')}`).join('')
      : `<li class="empty">${ev && !ev.on.items.length ? 'This event\'s BEO has no beverages on consumption. ' : ''}Add items below.</li>`;
    $('ocPreview').innerHTML = sheetsHtml(cur);
    $('ocStatus').textContent = cur.printedAt ? `Last printed ${new Date(cur.printedAt).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : '';
  }

  function addItem() {
    const name = $('ocAddName').value.trim(); if (!name) return;
    if (cur.items.some((i) => i.name.toLowerCase() === name.toLowerCase())) { if (opts.toast) opts.toast(`${name} is already on the sheet.`); return; }
    cur.items.push({ id: uid(), name, cat: $('ocAddCat').value });
    $('ocAddName').value = ''; save(); renderPanel(); $('ocAddName').focus();
  }
  // Typing a menu item's name picks its section.
  function guessAddCat() {
    const name = $('ocAddName').value.trim(); if (!name) return;
    const m = menuItems().find((i) => i.name.toLowerCase() === name.toLowerCase());
    $('ocAddCat').value = m ? m.cat : M().guessCat(name);
  }

  function open(key) {
    const list = upcoming(2);
    const first = list.find((x) => x.on.items.length) || list[0];
    $('ocDlg').showModal();
    load(key || (first ? first.key : 'new'));
  }

  function render() { try { renderWin(); renderPanel(); } catch (e) { console.error(e); if (global.__crownShowError) global.__crownShowError(`${e.message} (on-consumption sheets)`); } }

  function wire(o) {
    opts = o || {};
    const win = $('ocWin');
    win.addEventListener('click', (e) => { const li = e.target.closest('[data-oc-event]'); open(li ? li.dataset.ocEvent : null); });
    win.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === win) { e.preventDefault(); open(); } });
    $('ocEvent').addEventListener('change', (e) => load(e.target.value));
    const field = (id, k, fn) => $(id).addEventListener('input', (e) => { cur[k] = fn ? fn(e.target) : e.target.value; save(); $('ocPreview').innerHTML = sheetsHtml(cur); });
    field('ocName', 'name'); field('ocDate', 'date'); field('ocBars', 'bars'); field('ocFrom', 'from'); field('ocTo', 'to');
    field('ocBlanks', 'blanks', (t) => Math.max(0, Math.min(20, +t.value || 0)));
    $('ocPerBar').addEventListener('change', (e) => { cur.perBar = e.target.checked; save(); renderPanel(); });
    $('ocItems').addEventListener('input', (e) => { const id = e.target.dataset.ocName; if (!id) return; const it = cur.items.find((i) => i.id === id); if (it) { it.name = e.target.value; save(); $('ocPreview').innerHTML = sheetsHtml(cur); } });
    $('ocItems').addEventListener('change', (e) => { const id = e.target.dataset.ocCat; if (!id) return; const it = cur.items.find((i) => i.id === id); if (it) { it.cat = e.target.value; save(); renderPanel(); } });
    $('ocItems').addEventListener('click', (e) => { const b = e.target.closest('[data-oc-del]'); if (!b) return; cur.items = cur.items.filter((i) => i.id !== b.dataset.ocDel); save(); renderPanel(); });
    $('ocAdd').addEventListener('click', addItem);
    $('ocAddName').addEventListener('input', guessAddCat);
    $('ocAddName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } });
    $('ocReset').addEventListener('click', () => {
      if (!confirm('Start this sheet again from the BEO? Changes you made will be lost.')) return;
      const x = upcoming(14).find((y) => y.key === cur.key); if (!x) return;
      delete drafts[cur.key]; cur = fromEvent(x); save(); renderPanel();
    });
    $('ocPrintBtn').addEventListener('click', print);
    render();
  }

  global.CrownOnconUI = { wire, render, addMenu, removeMenu, clearMenus, menuIds, menuItems };
})(window);
