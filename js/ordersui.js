/* Bar orders add-on: pick a date range, see every event in it that has beverages (on consumption or a
 * package) with what each needs, totalled by category and product, and download it as an Excel workbook.
 *
 * Kept in this browser:
 *   crownDash.menus        Banquet Menus read from the linked folder: { id: { title, file, items: [{ name, cat }] } }
 *   crownDash.orderParams  the ordering figures (seated / cocktail / spirits), editable in the panel
 *   crownDash.orderChoices per event: { type, guests, primary: { red: name, … }, hidden, qty: { product: bottles },
 *                          added: [{ name, cat }] }
 *   crownDash.orderCats    categories changed by hand, by product name */
(function (global) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const todayISO = () => isoOf(new Date());
  const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return isoOf(d); };
  const fmtShort = (iso) => parseISO(iso).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtDMY = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  const O = () => global.CrownOrders;
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (_) { return d; } };
  const keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

  let menus = load('crownDash.menus', {});
  let params = null;
  let choices = load('crownDash.orderChoices', {});
  let catEdits = load('crownDash.orderCats', {});
  let opts = {};
  let ui = { from: null, to: null };
  const getParams = () => params || (params = Object.assign(JSON.parse(JSON.stringify(O().DEFAULTS)), load('crownDash.orderParams', {})));

  /* ---------- Menus ---------- */
  function addMenu(id, data) { menus[id] = data; keep('crownDash.menus', menus); render(); }
  function removeMenu(id) { if (menus[id]) { delete menus[id]; keep('crownDash.menus', menus); render(); } }
  function clearMenus() { menus = {}; keep('crownDash.menus', menus); render(); }
  const menuIds = () => Object.keys(menus);
  function menuItems() {
    const seen = new Set(), out = [];
    for (const m of Object.values(menus)) for (const it of m.items) { const k = it.name.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(it); } }
    return out;
  }

  /* ---------- Events in the range ---------- */
  const evKey = (e) => `${e.date}|${e.beo && e.beo.number ? 'beo' + e.beo.number : e.title.toLowerCase()}`;
  function eventsIn(from, to) {
    const out = [], menu = menuItems();
    for (let iso = from; iso <= to; iso = addDays(iso, 1)) {
      for (const e of (opts.events ? opts.events(iso) : [])) {
        const bev = global.CrownBeoBev ? global.CrownBeoBev.orderItems(e.beo.beverage) : { items: [] };
        const key = evKey(e), ch = choices[key] || {};
        if (!bev.items.length && !(ch.added || []).length) continue;
        const products = bev.items.map((name) => {
          const edited = catEdits[name.toLowerCase()];
          const c = O().categorise(name, menu);
          return { name, cat: edited || c.cat, fromMenu: c.fromMenu, edited: !!edited };
        });
        // Items added by hand for this event.
        for (const a of ch.added || []) if (!products.some((p) => p.name.toLowerCase() === a.name.toLowerCase())) products.push({ name: a.name, cat: a.cat, added: true, fromMenu: true });
        const type = ch.type || O().guessType(e);
        const guests = ch.guests != null && ch.guests !== '' ? +ch.guests : +e.pax || 0;
        const r = O().compute({ type, guests, products, primary: ch.primary || {}, params: getParams() });
        // Amounts typed in by hand replace the worked-out ones.
        const qty = ch.qty || {};
        for (const l of r.lines) if (qty[l.name] != null) { l.auto = l.bottles; l.bottles = qty[l.name]; l.manual = true; }
        out.push({ e, key, hidden: !!ch.hidden, softOnly: products.every((p) => p.cat === 'none'), clientSupplied: bev.clientSupplied, type, guessed: !ch.type, guests, guestsEdited: ch.guests != null && ch.guests !== '', products, tables: r.tables, lines: r.lines, packages: bev.packages, primary: ch.primary || {} });
      }
    }
    return out;
  }
  /** { cat: { product: bottles } } across events */
  function totals(list) {
    const t = {};
    for (const x of list) if (!x.hidden) for (const l of x.lines) if (l.bottles) { (t[l.cat] = t[l.cat] || {}); t[l.cat][l.name] = (t[l.cat][l.name] || 0) + l.bottles; }
    return t;
  }

  /* ---------- Window ---------- */
  function renderWin() {
    const body = $('ordWinBody'); if (!body) return;
    const from = todayISO(), to = addDays(from, 6);
    const list = eventsIn(from, to), t = totals(list);
    const nv = list.filter((x) => !x.hidden).length;
    $('ordWinSub').textContent = `Next 7 days · ${nv} event${nv === 1 ? '' : 's'} with beverages`;
    const cats = O().CATS.filter(([c]) => t[c]);
    body.innerHTML = list.length ? `<ul class="win-top">${cats.map(([c, n]) => `<li><span>${esc(n.replace(/ \(.*\)/, ''))}</span><b>${Object.values(t[c]).reduce((a, b) => a + b, 0).toLocaleString('en-AU')} btl</b></li>`).join('')}</ul>
      ${menuItems().length ? '' : '<p class="muted small">Link the Banquet Menu folder so products are put in the right category.</p>'}`
      : '<p class="win-empty">No events with beverages in the next 7 days. Click to choose dates.</p>';
  }

  /* ---------- Panel ---------- */
  const typeSel = (x) => `<select data-ord-type="${esc(x.key)}" aria-label="Event type">${O().TYPES.map(([v, n]) => `<option value="${v}" ${v === x.type ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
  const catSel = (p) => `<select class="ord-cat" data-ord-cat="${esc(p.name)}" aria-label="Category of ${esc(p.name)}" title="${p.edited ? 'Category set by you' : p.fromMenu ? 'From the Banquet Menu or the package-only wines' : 'Guessed from the name: not on a linked Banquet Menu'}">${O().CATS.map(([v, n]) => `<option value="${v}" ${v === p.cat ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>${!p.fromMenu && !p.edited && p.cat !== 'none' ? ' <span class="ord-guess" title="Not on a linked Banquet Menu: category guessed from the name">?</span>' : ''}`;

  function eventHtml(x) {
    const groups = {};
    for (const p of x.products) (groups[p.cat] = groups[p.cat] || []).push(p);
    // Primary pickers: two or more of a kind where it makes a difference.
    const picks = x.type === 'tasting' ? '' : ['red', 'white', 'beer'].filter((c) => (groups[c] || []).length > 1).map((c) => {
      const cur = x.primary[c] && groups[c].some((p) => p.name === x.primary[c]) ? x.primary[c] : groups[c][0].name;
      return `<label class="ord-pick">Primary ${esc(O().CAT_NAME[c].toLowerCase())} <select data-ord-primary="${esc(x.key)}" data-cat="${c}">${groups[c].map((p) => `<option ${p.name === cur ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>`;
    }).join('');
    const bottles = (name) => (x.lines.find((l) => l.name === name) || {});
    const k = esc(x.key);
    const qtyCell = (p, l) => {
      const auto = l.manual ? l.auto : l.bottles;
      return `<input type="number" min="0" class="ord-qty${l.manual ? ' set' : ''}" data-ord-qty="${k}" data-name="${esc(p.name)}" value="${l.manual ? l.bottles : ''}" placeholder="${p.cat === 'none' || (x.type === 'tasting' && !auto) ? '0' : (auto || 0)}" aria-label="Bottles of ${esc(p.name)} (leave empty for the worked-out amount)" title="Type a number to order a different amount; clear it to go back to the worked-out amount"> btl`;
    };
    return `<article class="ord-ev">
      <div class="ord-ev-head">
        <div><b>${esc(x.e.title)}</b><span class="muted small"> · ${esc(fmtShort(x.e.date))}${x.e.beo.number ? ` · BEO ${esc(x.e.beo.number)}` : ''}${x.e.subtitle ? ` · ${esc(x.e.subtitle)}` : ''}</span></div>
        <div class="ord-ev-opts">${typeSel(x)}${x.guessed ? '' : ' <span class="muted small">(set by you)</span>'}
          <label class="small">Guests <input type="number" min="0" value="${x.guests}" data-ord-guests="${esc(x.key)}" class="ord-guests"></label>
          ${x.type !== 'cocktail' && x.type !== 'tasting' ? `<span class="small muted">${x.tables} table${x.tables === 1 ? '' : 's'}</span>` : ''}
          <button type="button" class="btn ghost sm" data-ord-hide="${k}" title="Leave this event out of the order">Hide</button></div>
      </div>
      ${x.softOnly ? '<p class="muted small">Soft drinks only: nothing is ordered unless you enter an amount or add an item.</p>' : ''}
      ${!x.guests && x.type !== 'tasting' && !x.softOnly ? '<p class="win-warn">⚠ No guest number on the BEO: enter it to work out the order.</p>' : ''}
      ${x.clientSupplied && x.type !== 'tasting' ? '<p class="win-warn">⚠ The client supplies some of the drinks (corkage / sponsored), so only the items on consumption or in a package are ordered here, but the figures still assume they\'re for every guest. Check the bottles, and change the guests or set an item to "Not ordered" if needed.</p>' : ''}
      ${picks ? `<div class="ord-picks">${picks}</div>` : ''}
      <table class="ord-tbl"><tbody>${x.products.map((p) => { const l = bottles(p.name);
        const how = l.manual ? `entered by you${p.cat === 'none' ? '' : ` (worked out: ${(l.auto || 0).toLocaleString('en-AU')})`}` : l.how || '';
        return `<tr class="${p.cat === 'none' && !l.manual ? 'ord-none' : ''}"><td>${esc(p.name)}${p.added ? ' <span class="ord-added">added</span>' : ''}</td><td>${catSel(p)}</td><td class="n">${qtyCell(p, l)}</td><td class="muted small">${esc(how)}${p.added ? ` <button type="button" class="linkbtn" data-ord-unadd="${k}" data-name="${esc(p.name)}">remove</button>` : ''}</td></tr>`; }).join('')}</tbody></table>
      <div class="ord-add"><input type="text" placeholder="Add an item to this event, e.g. Peroni" data-ord-addname="${k}" list="ordProducts" aria-label="Item to add">
        <select data-ord-addcat="${k}" aria-label="Category">${O().CATS.map(([v, n]) => `<option value="${v}">${esc(n)}</option>`).join('')}</select>
        <input type="number" min="0" placeholder="btl" data-ord-addqty="${k}" aria-label="Bottles (optional)" class="ord-qty">
        <button type="button" class="btn sm" data-ord-add="${k}">Add</button></div>
    </article>`;
  }

  function renderPanel() {
    const dlg = $('ordDlg'); if (!dlg || !dlg.open) return;
    $('ordFrom').value = ui.from; $('ordTo').value = ui.to;
    const list = eventsIn(ui.from, ui.to), t = totals(list);
    const menu = menuItems();
    $('ordMenuNote').textContent = menu.length ? `Categories from the Banquet Menu (${menu.length} products from ${Object.values(menus).map((m) => m.title).join(', ')}); products marked ? aren't on it, so their category was guessed from the name.`
      : 'No Banquet Menu linked yet, so categories are guessed from product names. Link the Banquet Menu folder in 📁 Documents.';
    const cats = O().CATS.filter(([c]) => t[c]);
    $('ordTotals').innerHTML = list.length ? `<table class="ord-tot"><thead><tr><th>Category / product</th><th class="n">Bottles</th></tr></thead><tbody>${cats.map(([c, n]) => {
      const rows = Object.entries(t[c]).sort((a, b) => b[1] - a[1]);
      return `<tr class="ord-cat-row"><td>${esc(n)}</td><td class="n">${rows.reduce((a, r) => a + r[1], 0).toLocaleString('en-AU')}</td></tr>${rows.map(([p, b]) => `<tr><td class="ord-prod">${esc(p)}</td><td class="n">${b.toLocaleString('en-AU')}</td></tr>`).join('')}`; }).join('')}</tbody></table>`
      : '<p class="empty">No events with beverages (on consumption or a package) in these dates.</p>';
    $('ordCount').textContent = `${list.filter((x) => !x.hidden).length} event${list.filter((x) => !x.hidden).length === 1 ? '' : 's'}${list.some((x) => x.hidden) ? ` · ${list.filter((x) => x.hidden).length} hidden` : ''}`;
    const shown = list.filter((x) => !x.hidden), hid = list.filter((x) => x.hidden);
    $('ordEvents').innerHTML = shown.map(eventHtml).join('')
      + (hid.length ? `<details class="ok-list"><summary>${hid.length} event${hid.length === 1 ? '' : 's'} hidden (not in the order)</summary><ul>${hid.map((x) => `<li>${esc(x.e.title)} · ${esc(fmtShort(x.e.date))} <button type="button" class="linkbtn" data-ord-unhide="${esc(x.key)}">Show</button></li>`).join('')}</ul></details>` : '')
      + `<datalist id="ordProducts">${[...new Set([...menuItems().map((i) => i.name), ...list.flatMap((x) => x.products.map((p) => p.name))])].sort().map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>`;
    $('ordExcel').disabled = !list.some((x) => !x.hidden);
    renderParams();
  }

  /* ---------- Figures (editable) ---------- */
  function renderParams() {
    const P = getParams(), box = $('ordParams'); if (!box || box.dataset.drawn === JSON.stringify(P)) return;
    box.dataset.drawn = JSON.stringify(P);
    const num = (path, v, step) => `<input type="number" step="${step || 0.5}" min="0" value="${v}" data-ord-param="${path}">`;
    const slotRow = (cat, i, label) => { const s = P.cocktail[cat][i]; return `<tr><td>${label}</td><td>${num(`cocktail.${cat}.${i}.gpp`, s.gpp)}</td><td>${num(`cocktail.${cat}.${i}.gpb`, s.gpb, 1)}</td><td>${num(`cocktail.${cat}.${i}.pct`, s.pct, 1)} %</td></tr>`; };
    box.innerHTML = `<div class="ord-par-grid">
      <table class="ord-par"><caption>Seated (Sports · Corporate · Wedding)</caption>
        <tr><th></th><th>Sports</th><th>Corporate</th><th>Wedding</th></tr>
        <tr><td>Beer, per person</td>${['sports', 'corporate', 'wedding'].map((t) => `<td>${num(`seated.beer.${t}`, P.seated.beer[t])}</td>`).join('')}</tr>
        <tr><td>Light beer, per person</td>${['sports', 'corporate', 'wedding'].map((t) => `<td>${num(`seated.light.${t}`, P.seated.light[t])}</td>`).join('')}</tr>
        <tr><td>Red wine, per table</td><td colspan="3">${num('seated.red', P.seated.red)}</td></tr>
        <tr><td>White wine, per table</td><td colspan="3">${num('seated.white', P.seated.white)}</td></tr>
        <tr><td>Sparkling, per table</td><td colspan="3">${num('seated.sparkling', P.seated.sparkling)}</td></tr>
        <tr><td>Guests per table</td><td colspan="3">${num('seated.perTable', P.seated.perTable, 1)}</td></tr>
        <tr><td>Spirits, bottles each</td><td colspan="3">${num('spirits', P.spirits, 1)}</td></tr>
      </table>
      <table class="ord-par"><caption>Cocktail / Networking / Sundowner</caption>
        <tr><th></th><th>Per person</th><th>Gls / btl</th><th>Assumption</th></tr>
        ${slotRow('sparkling', 0, 'Sparkling wine')}${slotRow('red', 0, 'Red wine 1')}${slotRow('red', 1, 'Red wine 2')}${slotRow('white', 0, 'White wine 1')}${slotRow('white', 1, 'White wine 2')}${slotRow('beer', 0, 'Beer 1')}${slotRow('beer', 1, 'Beer 2')}${slotRow('light', 0, 'Light beer 1')}
      </table></div>
      <button class="linkbtn small" type="button" id="ordParamsReset">Put back the original figures</button>`;
  }
  function setParam(path, value) {
    const P = getParams(), parts = path.split('.');
    let o = P; for (const k of parts.slice(0, -1)) o = o[k];
    o[parts[parts.length - 1]] = Math.max(0, +value || 0);
    keep('crownDash.orderParams', P);
  }

  /* ---------- Excel ---------- */
  function excel() {
    const X = global.XLSX; if (!X) return;
    const list = eventsIn(ui.from, ui.to), t = totals(list);
    const typeName = Object.fromEntries(O().TYPES);
    const wb = X.utils.book_new();
    // Sheet 1: the order, by category.
    const n0 = list.filter((x) => !x.hidden).length;
    const rows = [['Bar order'], [`Events ${fmtDMY(ui.from)} to ${fmtDMY(ui.to)} · ${n0} event${n0 === 1 ? '' : 's'}`], [], ['Category', 'Product', 'Bottles']];
    for (const [c, n] of O().CATS) {
      if (!t[c]) continue;
      const items = Object.entries(t[c]).sort((a, b) => b[1] - a[1]);
      items.forEach(([p, b], i) => rows.push([i ? '' : n, p, b]));
      rows.push(['', `Total ${n}`, items.reduce((a, r) => a + r[1], 0)], []);
    }
    const ws1 = X.utils.aoa_to_sheet(rows);
    ws1['!cols'] = [{ wch: 34 }, { wch: 46 }, { wch: 10 }];
    ws1['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 2 } }];
    X.utils.book_append_sheet(wb, ws1, 'Order');
    // Sheet 2: each event.
    const ev = [['Date', 'Event', 'BEO #', 'Event type', 'Guests', 'Tables', 'Product', 'Category', 'Bottles', 'How it was worked out']];
    for (const x of list) if (!x.hidden) for (const l of x.lines) if (l.bottles) ev.push([fmtDMY(x.e.date), x.e.title, x.e.beo.number || '', typeName[x.type], x.guests, x.type === 'cocktail' || x.type === 'tasting' ? '' : x.tables, l.name, O().CAT_NAME[l.cat], l.bottles, l.manual ? `entered by hand (worked out: ${l.auto || 0})` : l.how]);
    const ws2 = X.utils.aoa_to_sheet(ev);
    ws2['!cols'] = [{ wch: 11 }, { wch: 34 }, { wch: 8 }, { wch: 22 }, { wch: 7 }, { wch: 7 }, { wch: 40 }, { wch: 22 }, { wch: 8 }, { wch: 46 }];
    X.utils.book_append_sheet(wb, ws2, 'By event');
    // Sheet 3: the figures used.
    const P = getParams();
    const fig = [['Seated', 'Sports', 'Corporate', 'Wedding'], ['Beer per person', P.seated.beer.sports, P.seated.beer.corporate, P.seated.beer.wedding],
      ['Light beer per person', P.seated.light.sports, P.seated.light.corporate, P.seated.light.wedding], ['Red wine per table', P.seated.red], ['White wine per table', P.seated.white],
      ['Sparkling per table', P.seated.sparkling], ['Guests per table', P.seated.perTable], ['Spirits, bottles each', P.spirits], [],
      ['Cocktail', 'Per person', 'Gls/Btl', 'Assumption %']];
    for (const [c, label] of [['sparkling', 'Sparkling wine'], ['red', 'Red wine'], ['white', 'White wine'], ['beer', 'Beer'], ['light', 'Light beer']]) P.cocktail[c].forEach((s, i) => fig.push([`${label} ${i + 1}`, s.gpp, s.gpb, s.pct]));
    const ws3 = X.utils.aoa_to_sheet(fig); ws3['!cols'] = [{ wch: 24 }, { wch: 11 }, { wch: 11 }, { wch: 13 }];
    X.utils.book_append_sheet(wb, ws3, 'Figures used');
    X.writeFile(wb, `Bar order ${fmtDMY(ui.from).replace(/\//g, '-')} to ${fmtDMY(ui.to).replace(/\//g, '-')}.xlsx`);
  }

  function render() { try { renderWin(); renderPanel(); } catch (e) { console.error(e); if (global.__crownShowError) global.__crownShowError(`${e.message} (bar orders)`); } }
  function open() { if (!ui.from) { ui.from = todayISO(); ui.to = addDays(ui.from, 6); } $('ordDlg').showModal(); renderPanel(); }

  function wire(o) {
    opts = o || {};
    const win = $('ordWin');
    win.addEventListener('click', open);
    win.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === win) { e.preventDefault(); open(); } });
    const dates = () => { const f = $('ordFrom').value, t = $('ordTo').value; if (f) ui.from = f; if (t) ui.to = t; if (ui.to < ui.from) ui.to = ui.from; renderPanel(); };
    $('ordFrom').addEventListener('change', dates); $('ordTo').addEventListener('change', dates);
    document.querySelectorAll('[data-ord-range]').forEach((b) => b.addEventListener('click', () => { const n = +b.dataset.ordRange; ui.from = todayISO(); ui.to = addDays(ui.from, n - 1); renderPanel(); }));
    $('ordExcel').addEventListener('click', excel);
    const ch = (key) => (choices[key] = choices[key] || {});
    $('ordEvents').addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.ordType) ch(t.dataset.ordType).type = t.value;
      else if (t.dataset.ordPrimary) { const c = ch(t.dataset.ordPrimary); c.primary = Object.assign({}, c.primary, { [t.dataset.cat]: t.value }); }
      else if (t.dataset.ordGuests) ch(t.dataset.ordGuests).guests = t.value === '' ? null : +t.value;
      else if (t.dataset.ordCat) catEdits[t.dataset.ordCat.toLowerCase()] = t.value;
      else if (t.dataset.ordQty) { const c = ch(t.dataset.ordQty); c.qty = Object.assign({}, c.qty); if (t.value === '') delete c.qty[t.dataset.name]; else c.qty[t.dataset.name] = Math.max(0, Math.round(+t.value || 0)); }
      else if (t.dataset.ordAddname) { const cat = t.closest('.ord-add').querySelector('[data-ord-addcat]'); const m = menuItems().find((i) => i.name.toLowerCase() === t.value.trim().toLowerCase()); cat.value = m || t.value.trim() ? O().categorise(t.value.trim(), menuItems()).cat.replace('none', cat.value) : cat.value; return; }
      else return;
      keep('crownDash.orderChoices', choices); keep('crownDash.orderCats', catEdits);
      render();
    });
    $('ordEvents').addEventListener('click', (e) => {
      const b = e.target.closest('[data-ord-hide],[data-ord-unhide],[data-ord-add],[data-ord-unadd]'); if (!b) return;
      if (b.dataset.ordHide) ch(b.dataset.ordHide).hidden = true;
      else if (b.dataset.ordUnhide) ch(b.dataset.ordUnhide).hidden = false;
      else if (b.dataset.ordUnadd) { const c = ch(b.dataset.ordUnadd); c.added = (c.added || []).filter((a) => a.name !== b.dataset.name); if (c.qty) delete c.qty[b.dataset.name]; }
      else {
        const row = b.closest('.ord-add'), name = row.querySelector('[data-ord-addname]').value.trim(); if (!name) return;
        const c = ch(b.dataset.ordAdd);
        if ((c.added || []).some((a) => a.name.toLowerCase() === name.toLowerCase())) { if (opts.toast) opts.toast(`${name} is already on this event.`); return; }
        c.added = [...(c.added || []), { name, cat: row.querySelector('[data-ord-addcat]').value }];
        const q = row.querySelector('[data-ord-addqty]').value;
        if (q !== '') c.qty = Object.assign({}, c.qty, { [name]: Math.max(0, Math.round(+q || 0)) });
      }
      keep('crownDash.orderChoices', choices); render();
    });
    $('ordEvents').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.closest('.ord-add')) { e.preventDefault(); e.target.closest('.ord-add').querySelector('[data-ord-add]').click(); } });
    $('ordParams').addEventListener('change', (e) => { if (e.target.dataset.ordParam) { setParam(e.target.dataset.ordParam, e.target.value); render(); } });
    $('ordParams').addEventListener('click', (e) => { if (e.target.id !== 'ordParamsReset') return; if (!confirm('Put back the original ordering figures?')) return; params = JSON.parse(JSON.stringify(O().DEFAULTS)); keep('crownDash.orderParams', params); render(); });
    render();
  }

  global.CrownOrdersUI = { wire, render, addMenu, removeMenu, clearMenus, menuIds, menuItems };
})(window);
