/* On-consumption sheets add-on: a printable check-off sheet for an event's bar(s), laid out like the
 * ON CONSUMPTION form (Event Name / Event Date / Bar Location / On consumption time, then Product |
 * Consumption, then "Entered By"). Items are what the event's BEO lists under "Beverages on consumption",
 * as written there, in the same order; more can be added or removed by hand. Nothing is priced.
 * Sheets being worked on are kept as drafts in this browser, one per event. */
(function (global) {
  'use strict';
  const DRAFT_KEY = 'crownDash.onconDrafts';
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
  const B = () => global.CrownBeoBev;

  let drafts = {}, opts = {};
  // Drafts from before version 2 could hold item names that weren't on the BEO (an earlier version
  // matched them to a menu and listed soft drinks separately): they're thrown away.
  const DRAFT_V = 2;
  let cur = null;          // the sheet open in the panel: { key, eventId, name, date, bars, from, to, perBar, blanks, items: [{ id, name }] }
  try { drafts = JSON.parse(localStorage.getItem(DRAFT_KEY)) || {}; } catch (_) {}
  if (Object.keys(drafts).some((k) => drafts[k].v !== DRAFT_V)) {
    for (const k of Object.keys(drafts)) if (drafts[k].v !== DRAFT_V) delete drafts[k];
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts)); } catch (_) {}
  }
  const storeDrafts = () => {
    // Keep the 60 most recent drafts.
    const keys = Object.keys(drafts).sort((a, b) => (drafts[b].savedAt || '').localeCompare(drafts[a].savedAt || ''));
    for (const k of keys.slice(60)) delete drafts[k];
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts)); } catch (_) {}
  };

  /* ---------- Events ---------- */
  const evKey = (e) => `${e.date}|${e.beo && e.beo.number ? 'beo' + e.beo.number : e.title.toLowerCase()}`;
  /** Events from today on (for the picker / window), with what their BEO says about on-consumption. */
  function upcoming(days) {
    const out = [];
    for (let i = 0; i < days; i++) {
      const iso = addDays(todayISO(), i);
      for (const e of (opts.events ? opts.events(iso) : [])) {
        if (e.setup) continue;
        // Only BEOs with a "Beverages on consumption" line in their Beverage section.
        const on = B() && e.beo ? B().fromBEO(e.beo.beverage) : null;
        if (on && on.has) out.push({ e, key: evKey(e), on });
      }
    }
    return out;
  }

  /** A fresh sheet for an event: details from the event, items from its BEO as written. */
  function fromEvent(x) {
    const e = x.e;
    return { key: x.key, eventId: e.id, name: e.title, date: e.date, bars: (e.bars || []).join(', ') || e.venue || '',
      from: x.on.from || e.start || '', to: x.on.to || '', perBar: false, blanks: 3, items: x.on.items.map((name) => ({ id: uid(), name })),
      v: DRAFT_V, beoItems: [...x.on.items] };
  }
  const blank = () => ({ v: DRAFT_V, key: 'new', eventId: '', name: '', date: todayISO(), bars: '', from: '', to: '', perBar: false, blanks: 3, items: [] });
  let n = 0;
  const uid = () => 'i' + Date.now().toString(36) + (n++);

  /* ---------- The printed sheet ---------- */
  function sheetHtml(s, bar) {
    const rows = s.items.length + (+s.blanks || 0);
    const time = s.from ? `${t12(s.from)} – ${s.to ? t12(s.to) : ''}` : '';
    return `<section class="oc-sheet${rows > 30 ? ' compact' : ''}">
      <table class="oc-head"><tbody>
        <tr><th>Event Name</th><td>${esc(s.name)}</td></tr>
        <tr><th>Event Date</th><td>${esc(fmtLong(s.date))}</td></tr>
        <tr><th>Bar Location</th><td>${esc(bar)}</td></tr>
        <tr><th>On consumption</th><td>${esc(time)}</td></tr>
      </tbody></table>
      <table class="oc-items"><thead><tr><th>Product</th><th class="c">Consumption</th></tr></thead>
        <tbody>${s.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="c"></td></tr>`).join('')}
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
    $('ocWinSub').textContent = 'Check-off sheets from the BEO';
    if (!list.length) { body.innerHTML = '<li class="win-empty">No BEOs with beverages on consumption today or tomorrow. Click to make a sheet by hand.</li>'; return; }
    const show = list;
    body.innerHTML = ''
      + show.slice(0, 6).map((x) => { const d = drafts[x.key];
        return `<li class="oc-li" data-oc-event="${esc(x.key)}"><div class="win-ev"><span>${esc(x.e.title)}</span><span class="t">${esc(x.e.date === todayISO() ? 'Today' : 'Tomorrow')}${x.on.from ? ' · ' + esc(t12(x.on.from)) : ''}</span></div>
          <div class="mgr-evs">${x.on.items.length ? `${x.on.items.length} item${x.on.items.length === 1 ? '' : 's'} on consumption` : 'nothing on consumption on the BEO'}${d && d.printedAt ? ` · <span class="oc-printed">✓ printed</span>` : d ? ' · draft saved' : ''}</div></li>`; }).join('');
  }

  /* ---------- Panel ---------- */
  function save() { if (!cur) return; cur.savedAt = new Date().toISOString(); drafts[cur.key] = JSON.parse(JSON.stringify(cur)); storeDrafts(); }

  function load(key) {
    const list = upcoming(14);
    if (key === 'new') cur = drafts.new ? JSON.parse(JSON.stringify(drafts.new)) : blank();
    else {
      const x = list.find((y) => y.key === key), d = drafts[key];
      if (d && (!x || JSON.stringify(d.beoItems || []) === JSON.stringify(x.on.items))) cur = JSON.parse(JSON.stringify(d));
      else if (x) {
        // No draft, or the BEO's list has changed since the draft was made (a revised BEO): start from the
        // BEO again, keeping anything that was added by hand.
        cur = fromEvent(x);
        if (d) {
          const extra = (d.items || []).filter((i) => i.added && !cur.items.some((c) => c.name.toLowerCase() === i.name.toLowerCase()));
          cur.items.push(...extra);
          save();
          if (opts.toast) opts.toast('The BEO has changed since this sheet was started, so its items have been updated from the BEO.');
        }
      } else cur = blank();
    }
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
    // Suggestions when adding: anything on consumption on the BEOs in the next two weeks.
    $('ocMenuList').innerHTML = [...new Set(list.flatMap((x) => x.on.items))].sort().map((n) => `<option value="${esc(n)}"></option>`).join('');
    const ev = list.find((x) => x.key === cur.key);
    $('ocReset').hidden = !ev;
    $('ocItems').innerHTML = cur.items.length ? cur.items.map((i, k) => `
        <li class="oc-row"><input type="text" value="${esc(i.name)}" data-oc-name="${esc(i.id)}" aria-label="Item name">
          <span class="oc-move"><button type="button" class="btn ghost sm" data-oc-up="${esc(i.id)}" aria-label="Move up" title="Move up" ${k === 0 ? 'disabled' : ''}>↑</button><button type="button" class="btn ghost sm" data-oc-down="${esc(i.id)}" aria-label="Move down" title="Move down" ${k === cur.items.length - 1 ? 'disabled' : ''}>↓</button></span>
          <button type="button" class="btn ghost sm" data-oc-del="${esc(i.id)}" aria-label="Remove ${esc(i.name)}" title="Remove">✕</button></li>`).join('')
      : `<li class="empty">${ev && !ev.on.items.length ? 'This event\'s BEO has no beverages on consumption. ' : ''}Add items below.</li>`;
    $('ocPreview').innerHTML = sheetsHtml(cur);
    $('ocStatus').textContent = cur.printedAt ? `Last printed ${new Date(cur.printedAt).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : '';
  }

  function addItem() {
    const name = $('ocAddName').value.trim(); if (!name) return;
    if (cur.items.some((i) => i.name.toLowerCase() === name.toLowerCase())) { if (opts.toast) opts.toast(`${name} is already on the sheet.`); return; }
    cur.items.push({ id: uid(), name, added: true });
    $('ocAddName').value = ''; save(); renderPanel(); $('ocAddName').focus();
  }
  function open(key) {
    const list = upcoming(2);
    const first = list[0];
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
    $('ocItems').addEventListener('click', (e) => {
      const del = e.target.closest('[data-oc-del]'), up = e.target.closest('[data-oc-up]'), down = e.target.closest('[data-oc-down]');
      if (del) cur.items = cur.items.filter((i) => i.id !== del.dataset.ocDel);
      else if (up || down) {
        const k = cur.items.findIndex((i) => i.id === (up ? up.dataset.ocUp : down.dataset.ocDown)), to = k + (up ? -1 : 1);
        if (k < 0 || to < 0 || to >= cur.items.length) return;
        [cur.items[k], cur.items[to]] = [cur.items[to], cur.items[k]];
      } else return;
      save(); renderPanel();
    });
    $('ocAdd').addEventListener('click', addItem);
    $('ocAddName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } });
    $('ocReset').addEventListener('click', () => {
      if (!confirm('Start this sheet again from the BEO? Changes you made will be lost.')) return;
      const x = upcoming(14).find((y) => y.key === cur.key); if (!x) return;
      delete drafts[cur.key]; cur = fromEvent(x); save(); renderPanel();
    });
    $('ocPrintBtn').addEventListener('click', print);
    render();
  }

  global.CrownOnconUI = { wire, render };
})(window);
