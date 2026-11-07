/* "Bar consumption" add-on: a small window on the main page with this week's totals, and a panel
 * where totals can be picked apart: by period, grouped by product / category / event / bar / day /
 * event type / event manager / service manager / room, filtered by clicking rows, and exported to CSV.
 * Data comes from consumption workbooks (js/consumption.js), kept per day in IndexedDB. */
(function (global) {
  'use strict';
  const C = () => global.CrownCons;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const fmtDay = (iso) => (iso ? parseISO(iso).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : '—');
  const fmtDayY = (iso) => parseISO(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  const money = (n) => (n == null || !isFinite(n) ? '—' : n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }));
  const int = (n) => Math.round(n || 0).toLocaleString('en-AU');
  const pct = (n) => (n == null || !isFinite(n) ? '—' : `${(n * 100).toFixed(1)}%`);

  let cache = {};          // sourceId → { date, events, rows }
  let opts = {};           // { toast }
  const ui = { period: 'thisMonth', from: '', to: '', group: 'product', filters: [], search: '', sort: null };

  /* ---------- Data ---------- */
  async function load() { try { cache = await C().all(); } catch (_) { cache = {}; } render(); }
  function add(id, day) { cache[id] = day; C().put(id, day).catch(() => opts.toast && opts.toast('Couldn\'t save the consumption data in this browser.')); render(); }
  function remove(id) { delete cache[id]; C().remove(id).catch(() => {}); render(); }
  function clear() { cache = {}; C().clear().catch(() => {}); render(); }
  const days = () => cache;

  /** Flatten every stored day into event records and product rows (rows carry their event's details). */
  function flatten() {
    const events = [], rows = [];
    for (const [id, day] of Object.entries(cache)) {
      (day.events || []).forEach((e, i) => {
        const ev = Object.assign({ key: `${id}#${i}` }, e);
        events.push(ev);
        for (const r of day.rows || []) if (r.ev === i) rows.push(Object.assign({}, r, { e: ev }));
      });
    }
    return { events, rows };
  }

  /* ---------- Periods ---------- */
  function range(period) {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const mon = new Date(t); mon.setDate(t.getDate() - ((t.getDay() + 6) % 7));
    const add = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
    switch (period) {
      case 'thisWeek': return [isoOf(mon), isoOf(add(mon, 6))];
      case 'lastWeek': return [isoOf(add(mon, -7)), isoOf(add(mon, -1))];
      case 'thisMonth': return [isoOf(new Date(t.getFullYear(), t.getMonth(), 1)), isoOf(new Date(t.getFullYear(), t.getMonth() + 1, 0))];
      case 'lastMonth': return [isoOf(new Date(t.getFullYear(), t.getMonth() - 1, 1)), isoOf(new Date(t.getFullYear(), t.getMonth(), 0))];
      case 'last3': return [isoOf(new Date(t.getFullYear(), t.getMonth() - 3, t.getDate())), isoOf(t)];
      case 'thisFY': { const y = t.getMonth() >= 6 ? t.getFullYear() : t.getFullYear() - 1; return [`${y}-07-01`, `${y + 1}-06-30`]; }
      case 'lastFY': { const y = (t.getMonth() >= 6 ? t.getFullYear() : t.getFullYear() - 1) - 1; return [`${y}-07-01`, `${y + 1}-06-30`]; }
      case 'thisYear': return [`${t.getFullYear()}-01-01`, `${t.getFullYear()}-12-31`];
      case 'custom': return [ui.from || '0000-01-01', ui.to || '9999-12-31'];
      default: return ['0000-01-01', '9999-12-31'];
    }
  }

  /* ---------- Grouping ---------- */
  const sizeTxt = (s) => (s ? ` (${s}${s >= 100 ? 'ml' : ''})` : '');
  const GROUPS = {
    product: { label: 'Product', row: true, key: (r) => r.prod + sizeTxt(r.size), next: 'event' },
    category: { label: 'Category', row: true, key: (r) => r.cat || 'Other', next: 'product' },
    bar: { label: 'Bar', row: true, key: (r) => r.bar, next: 'product' },
    event: { label: 'Event', key: (e) => `${e.event} · ${fmtDay(e.date)}`, next: 'product' },
    day: { label: 'Day', key: (e) => e.date, show: fmtDay, next: 'event' },
    fy: { label: 'Financial year', key: (e) => { const [y, m] = (e.date || '0-0').split('-').map(Number); const s = m >= 7 ? y : y - 1; return `FY ${s}–${String(s + 1).slice(2)}`; }, next: 'month' },
    month: { label: 'Month', key: (e) => (e.date || '').slice(0, 7), show: (k) => (k ? parseISO(k + '-01').toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }) : '—'), next: 'event' },
    type: { label: 'Event type', key: (e) => e.type || '—', next: 'event' },
    em: { label: 'Event manager', key: (e) => e.em || '—', next: 'event' },
    sm: { label: 'Service manager', key: (e) => e.sm || '—', next: 'event' },
    room: { label: 'Room', key: (e) => e.room || '—', next: 'event' },
  };
  const keyOf = (g, r) => (GROUPS[g].row ? GROUPS[g].key(r) : GROUPS[g].key(r.e || r));

  /** Applies period, filters and search. Returns matching events and rows. */
  function select() {
    const [from, to] = range(ui.period);
    const { events, rows } = flatten();
    const inPeriod = (e) => e.date >= from && e.date <= to;
    const evOk = (e) => inPeriod(e) && ui.filters.every((f) => GROUPS[f.g].row || GROUPS[f.g].key(e) === f.v);
    const q = ui.search.trim().toLowerCase();
    // Search: if it matches an event (name, BEO #, room, managers, type), show those events — including
    // ones that used no stock. Otherwise it searches products, categories and bars.
    const evText = (e) => `${e.event} ${e.beo} ${e.room} ${e.em} ${e.sm} ${e.dm} ${e.type}`.toLowerCase();
    const evSearch = !!q && events.some((e) => evOk(e) && evText(e).includes(q));
    const evOk2 = (e) => evOk(e) && (!evSearch || evText(e).includes(q));
    const rowOk = (r) => evOk2(r.e) && ui.filters.every((f) => !GROUPS[f.g].row || GROUPS[f.g].key(r) === f.v)
      && (!q || evSearch || `${r.prod} ${r.cat} ${r.bar}`.toLowerCase().includes(q));
    const rowFiltered = (!!q && !evSearch) || ui.filters.some((f) => GROUPS[f.g].row);
    const selRows = rows.filter(rowOk);
    const selEvents = rowFiltered ? [...new Map(selRows.map((r) => [r.e.key, r.e])).values()] : events.filter(evOk2);
    return { events: selEvents, rows: selRows, rowFiltered, evSearch, from, to };
  }


  function summarise(sel) {
    const s = { events: sel.events.length, pax: sel.events.reduce((a, e) => a + (e.pax || 0), 0),
      units: sel.rows.reduce((a, r) => a + r.used, 0), charge: sel.rows.reduce((a, r) => a + r.chg, 0), rowCost: sel.rows.reduce((a, r) => a + r.cost, 0),
      revenue: sel.events.reduce((a, e) => a + (e.revenue || 0), 0), cost: sel.events.reduce((a, e) => a + (e.cost || 0), 0) };
    s.costPct = s.revenue ? s.cost / s.revenue : null;
    s.perHead = s.pax ? s.revenue / s.pax : null;
    return s;
  }

  function table(sel) {
    const g = GROUPS[ui.group];
    const eventLevel = !g.row && !sel.rowFiltered;
    const map = new Map();
    const get = (k) => map.get(k) || map.set(k, { k, units: 0, charge: 0, cost: 0, revenue: 0, pax: 0, ev: new Set() }).get(k);
    for (const r of sel.rows) { const x = get(keyOf(ui.group, r)); x.units += r.used; x.charge += r.chg; if (!eventLevel) x.cost += r.cost; x.ev.add(r.e.key); }
    if (eventLevel) for (const e of sel.events) { const x = get(g.key(e)); x.revenue += e.revenue || 0; x.cost += e.cost || 0; x.pax += e.pax || 0; x.ev.add(e.key); if (missingRevenue(e)) x.flag = (x.flag || 0) + 1; }
    const cols = eventLevel
      ? [['units', 'Units used'], ['pax', 'Pax'], ['revenue', 'Bev revenue (ex GST)'], ['cost', 'Bev cost'], ['pct', 'Cost %'], ['events', 'Events']]
      : [['units', 'Units used'], ['charge', 'On-consumption value (inc GST)'], ['cost', 'Cost'], ['events', 'Events']];
    let list = [...map.values()].map((x) => Object.assign(x, { events: x.ev.size, pct: x.revenue ? x.cost / x.revenue : null }));
    const sort = ui.sort || (ui.group === 'day' || ui.group === 'month' || ui.group === 'fy' ? { col: 'k', dir: 1 } : { col: eventLevel ? 'revenue' : 'units', dir: -1 });
    list.sort((a, b) => { const va = a[sort.col], vb = b[sort.col]; return (typeof va === 'string' ? va.localeCompare(vb) : (va || 0) - (vb || 0)) * sort.dir; });
    return { cols, list, eventLevel, sort };
  }

  /* Stock was used but no beverage revenue was entered in the report (e.g. a service manager missed it). */
  const missingRevenue = (e) => (e.units > 0 || e.cost > 0) && !e.revenue;
  // "Charlie - TL Yulei" / "Ashleigh/ Richard TL: Caitlin" → "Charlie" / "Ashleigh/ Richard"
  const smOf = (e) => (e.sm ? e.sm.split(/\s+-\s+|\s*\bTL\b|:/i)[0].replace(/[\s\-\/]+$/, '').trim() : '');

  /* ---------- Rendering ---------- */
  function renderWin() {
    const body = $('consWinBody'); if (!body) return;
    const all = flatten();
    if (!all.events.length) {
      $('consWinSub').textContent = 'No consumption workbooks loaded yet';
      body.innerHTML = '<p class="win-empty">Link the folder of consumption workbooks under <b>Documents → Link another folder</b>, or use Load documents.</p>';
      return;
    }
    // This week, or the latest week with data.
    let [from, to] = range('thisWeek'); let label = 'This week';
    if (!all.events.some((e) => e.date >= from && e.date <= to)) {
      const last = all.events.map((e) => e.date).sort().pop();
      const d = parseISO(last); const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      [from, to] = [isoOf(mon), isoOf(sun)]; label = `Week of ${fmtDay(from)}`;
    }
    const evs = all.events.filter((e) => e.date >= from && e.date <= to);
    const rows = all.rows.filter((r) => r.e.date >= from && r.e.date <= to);
    const s = summarise({ events: evs, rows });
    const top = new Map(); for (const r of rows) top.set(r.prod, (top.get(r.prod) || 0) + r.used);
    const best = [...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    $('consWinSub').textContent = `${label} · ${s.events} event${s.events === 1 ? '' : 's'}`;
    const miss = evs.filter(missingRevenue);
    body.innerHTML = `<div class="kpis">
        <div><span>Units used</span><b>${int(s.units)}</b></div>
        <div><span>Bev revenue</span><b>${money(s.revenue)}</b></div>
        <div><span>Bev cost</span><b>${money(s.cost)}</b></div>
        <div><span>Cost %</span><b>${pct(s.costPct)}</b></div>
      </div>
      ${miss.length ? `<p class="win-warn">⚠ No revenue entered: ${miss.map((e) => esc(e.event) + (smOf(e) ? ` (${esc(smOf(e))})` : '')).join(', ')}</p>` : ''}
      ${best.length ? `<p class="label" style="margin:10px 0 4px">Most used</p><ul class="win-top">${best.map(([p, n]) => `<li><span>${esc(p)}</span><b>${int(n)}</b></li>`).join('')}</ul>` : ''}`;
  }

  function renderPanel() {
    const dlg = $('consDlg'); if (!dlg || !dlg.open) return;
    $('consPeriod').value = ui.period; $('consGroup').value = ui.group;
    $('consCustom').hidden = ui.period !== 'custom';
    const sel = select(); const s = summarise(sel);
    $('consRange').textContent = ui.period === 'all' ? 'All loaded days'
      : `${sel.from.startsWith('0000') ? '…' : fmtDayY(sel.from)} – ${sel.to.startsWith('9999') ? '…' : fmtDayY(sel.to)}`;
    $('consChips').innerHTML = ui.filters.map((f, i) => `<span class="fchip">${esc(GROUPS[f.g].label)}: <b>${esc(GROUPS[f.g].show ? GROUPS[f.g].show(f.v) : f.v)}</b><button type="button" data-unfilter="${i}" aria-label="Remove filter">×</button></span>`).join('')
      + (ui.filters.length > 1 ? '<button type="button" class="linkbtn" data-unfilter="all">Clear all</button>' : '');
    const missing = sel.events.filter(missingRevenue).sort((a, b) => a.date.localeCompare(b.date));
    $('consAlerts').innerHTML = missing.length ? `<div class="rev-alert"><strong>⚠ ${missing.length} event${missing.length === 1 ? '' : 's'} used stock but ${missing.length === 1 ? 'has' : 'have'} no beverage revenue entered in the report</strong><ul>${missing.map((e) =>
      `<li><b>${esc(e.event)}</b> · ${esc(fmtDay(e.date))}${e.beo ? ` · BEO ${esc(e.beo)}` : ''} · ${int(e.units)} units, ${money(e.cost)} cost${smOf(e) ? ` · Service manager: <b>${esc(smOf(e))}</b>` : ''}</li>`).join('')}</ul>
      <p class="muted small">Until the figures are entered in the workbook, revenue is understated and cost % overstated for this period. Once it's re-saved, the dashboard picks it up automatically.</p></div>` : '';
    $('consCards').innerHTML = (sel.rowFiltered
      ? [['Units used', int(s.units)], ['On-consumption value', money(s.charge)], ['Cost', money(s.rowCost)], ['Events', int(s.events)]]
      : [['Events', int(s.events)], ['Pax', int(s.pax)], ['Units used', int(s.units)], ['Bev revenue (ex GST)', money(s.revenue)], ['Bev cost', money(s.cost)], ['Cost %', pct(s.costPct)], ['Revenue per head', money(s.perHead)]])
      .map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    const t = table(sel); lastTable = t;
    const g = GROUPS[ui.group];
    const fmt = (c, x) => (c === 'units' || c === 'pax' || c === 'events' ? int(x[c]) : c === 'pct' ? pct(x[c]) : money(x[c]));
    const arrow = (c) => (t.sort.col === c ? (t.sort.dir > 0 ? ' ▲' : ' ▼') : '');
    $('consTable').innerHTML = t.list.length ? `<table><thead><tr><th data-sort="k">${esc(g.label)}${arrow('k')}</th>${t.cols.map(([c, l]) => `<th data-sort="${c}" class="n">${l}${arrow(c)}</th>`).join('')}</tr></thead>
      <tbody>${t.list.map((x) => `<tr data-drill="${esc(x.k)}" title="Show only ${esc(g.show ? g.show(x.k) : x.k)}"><td>${esc(g.show ? g.show(x.k) : x.k)}${x.flag ? ` <span class="rev-flag" title="Stock used but no beverage revenue entered">⚠ no revenue entered${ui.group === 'event' ? '' : ` (${x.flag})`}</span>` : ''}</td>${t.cols.map(([c]) => `<td class="n">${fmt(c, x)}</td>`).join('')}</tr>`).join('')}</tbody>
      <tfoot><tr><td>Total</td>${t.cols.map(([c]) => `<td class="n">${c === 'pct' ? pct(t.list.reduce((a, x) => a + x.cost, 0) / (t.list.reduce((a, x) => a + x.revenue, 0) || NaN)) : c === 'events' ? int(s.events) : fmt(c, { [c]: t.list.reduce((a, x) => a + (x[c] || 0), 0) })}</td>`).join('')}</tr></tfoot></table>`
      : sel.events.length ? `<p class="empty">${sel.events.length === 1 ? `${esc(sel.events[0].event)} has` : `These ${sel.events.length} events have`} no stock used. Choose an event-level "Total by" (Event, Day, Month…) to see revenue and pax.</p>`
      : '<p class="empty">Nothing in this period. Try a longer period, or remove a filter.</p>';
    $('consNote').textContent = t.list.length && !t.eventLevel
      ? 'Units, values and costs here come from each bar\'s sheet. The official event Bev cost (from each Total block) can differ slightly for à la carte items.'
      : t.list.length ? 'Revenue, cost and cost % are each event\'s official figures from its Total block (the same numbers as the workbook\'s Summary tab).' : '';
  }
  let lastTable = null;

  function render() { renderWin(); renderPanel(); }

  function exportCsv() {
    if (!lastTable) return;
    const g = GROUPS[ui.group];
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [[g.label, ...lastTable.cols.map(([, l]) => l)].map(q).join(',')];
    for (const x of lastTable.list) lines.push([g.show ? g.show(x.k) : x.k, ...lastTable.cols.map(([c]) => (c === 'pct' ? (x.pct == null ? '' : (x.pct * 100).toFixed(1)) : (Math.round((x[c] || 0) * 100) / 100)))].map(q).join(','));
    const [from, to] = range(ui.period);
    const name = `bar-consumption_${g.label.toLowerCase().replace(/\s+/g, '-')}_${ui.period === 'all' ? 'all' : from + '_' + to}.csv`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function open() { $('consDlg').showModal(); renderPanel(); }

  function wire(o) {
    opts = o || {};
    const win = $('consWin');
    win.addEventListener('click', (e) => { if (!e.target.closest('button, a')) open(); });
    win.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === win) { e.preventDefault(); open(); } });
    $('consPeriod').onchange = (e) => { ui.period = e.target.value; ui.sort = null; renderPanel(); };
    $('consGroup').onchange = (e) => { ui.group = e.target.value; ui.sort = null; renderPanel(); };
    $('consFrom').onchange = (e) => { ui.from = e.target.value; renderPanel(); };
    $('consTo').onchange = (e) => { ui.to = e.target.value; renderPanel(); };
    $('consSearch').oninput = (e) => { ui.search = e.target.value; renderPanel(); };
    $('consExport').onclick = exportCsv;
    $('consDlg').addEventListener('click', (e) => {
      if (e.target === $('consDlg')) return $('consDlg').close();
      const th = e.target.closest('[data-sort]');
      if (th) { const c = th.dataset.sort; const cur = ui.sort || lastTable.sort; ui.sort = { col: c, dir: cur.col === c ? -cur.dir : (c === 'k' ? 1 : -1) }; return renderPanel(); }
      const tr = e.target.closest('[data-drill]');
      if (tr) { ui.filters.push({ g: ui.group, v: tr.dataset.drill }); ui.group = GROUPS[ui.group].next; ui.sort = null; return renderPanel(); }
      const un = e.target.closest('[data-unfilter]');
      if (un) { if (un.dataset.unfilter === 'all') ui.filters = []; else ui.filters.splice(+un.dataset.unfilter, 1); renderPanel(); }
    });
    $('consGroup').innerHTML = Object.entries(GROUPS).map(([k, g]) => `<option value="${k}">${g.label}</option>`).join('');
  }

  global.CrownConsUI = { load, add, remove, clear, days, render, wire, open, _ui: ui };
})(window);
