/* Managers add-on: who is on today (window) and the week's allocation (panel), from the
 * Manager Allocation workbooks. Each week is kept in this browser (localStorage), one per week. */
(function (global) {
  'use strict';
  const KEY = 'crownDash.mgr';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const todayISO = () => isoOf(new Date());
  const fmtDay = (iso) => parseISO(iso).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtShort = (iso) => parseISO(iso).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
  const t12 = (t) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${pad(m)}${h < 12 || h === 24 ? 'am' : 'pm'}`; };

  let weeks = {};          // id → { weekStart, dates, people, file }
  let opts = {};
  let ui = { week: null };

  function load() { try { weeks = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (_) { weeks = {}; } }
  function store() { try { localStorage.setItem(KEY, JSON.stringify(weeks)); } catch (_) {} }
  function add(id, data) { weeks[id] = data; store(); render(); }
  function remove(id) { if (weeks[id]) { delete weeks[id]; store(); render(); } }
  function clear() { weeks = {}; store(); render(); }
  const ids = () => Object.keys(weeks);

  /** The allocation covering a date (a later-loaded copy of the same week wins). */
  function weekFor(iso) {
    let best = null;
    for (const w of Object.values(weeks)) if (w.dates.includes(iso) && (!best || (w.savedAt || 0) >= (best.savedAt || 0))) best = w;
    return best;
  }
  const sortedWeeks = () => [...new Map(Object.values(weeks).map((w) => [w.weekStart, weekFor(w.weekStart)])).values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  // Leave codes in full, for tooltips and the "Off" line.
  const LEAVE = { RDO: 'RDO', AL: 'Annual leave', 'A/L': 'Annual leave', SL: 'Sick leave', 'S/L': 'Sick leave', SICK: 'Sick leave',
    LSL: 'Long service leave', PH: 'Public holiday', 'PUBLIC HOLIDAY': 'Public holiday', LWOP: 'Leave without pay', 'ANNUAL LEAVE': 'Annual leave' };
  const offName = (code) => LEAVE[code] || code;
  const working = (d) => d && !d.off && !!(d.start || d.text || d.events.length);
  const timeText = (d) => (d.start ? t12(d.start) + (d.end ? `–${t12(d.end)}` : '') : d.text || 'time not set');
  const isMe = (p) => { const me = (opts.myName ? opts.myName() : '').trim().toLowerCase(); return !!me && p.name.toLowerCase().split(/\s+/).some((w) => w === me || p.name.toLowerCase() === me); };
  const nameOf = (p) => (p.name ? esc(p.name) : '<i class="mgr-noname">Name not filled in</i>');

  function onDay(w, iso) {
    const on = [], off = [];
    for (const p of w.people) { const d = p.days[iso]; if (working(d)) on.push({ p, d }); else if (d && d.off && p.name) off.push({ p, d }); }
    on.sort((a, b) => (a.d.start || '99').localeCompare(b.d.start || '99') || a.p.name.localeCompare(b.p.name));
    return { on, off };
  }

  function renderWin() {
    const body = $('mgrWinList'); if (!body) return;
    const iso = todayISO(), w = weekFor(iso);
    $('mgrWinSub').textContent = fmtDay(iso);
    if (!w) {
      body.innerHTML = `<li class="win-empty">${ids().length ? 'No manager allocation loaded for this week yet.' : 'Link the folder with the Manager Allocation workbooks (📁 in the header), or load one with 📂.'}</li>`;
      return;
    }
    const { on, off } = onDay(w, iso);
    body.innerHTML = (on.length ? on.map(({ p, d }) => `<li class="mgr-li${isMe(p) ? ' mine' : ''}">
        <div class="win-ev"><span>${nameOf(p)}${p.role ? ` <span class="mgr-role">${esc(p.role)}</span>` : ''}</span><span class="t">${esc(timeText(d))}</span></div>
        ${d.events.length ? `<div class="mgr-evs">${d.events.map(esc).join(' · ')}</div>` : ''}</li>`).join('')
      : '<li class="win-empty">No managers rostered today.</li>')
      + (off.length ? `<li class="mgr-off">Off: ${off.map(({ p, d }) => `${esc(p.name.split(' ')[0])} <span>(${esc(offName(d.off))})</span>`).join(', ')}</li>` : '');
  }

  function renderPanel() {
    const dlg = $('mgrDlg'); if (!dlg || !dlg.open) return;
    const list = sortedWeeks();
    let w = list.find((x) => x.weekStart === ui.week) || weekFor(todayISO()) || list[list.length - 1];
    if (!w) { $('mgrGrid').innerHTML = '<p class="empty">No manager allocation loaded yet.</p>'; $('mgrRange').textContent = ''; return; }
    ui.week = w.weekStart;
    const i = list.indexOf(w);
    $('mgrPrev').disabled = i <= 0; $('mgrNext').disabled = i >= list.length - 1;
    $('mgrRange').textContent = `${fmtShort(w.dates[0])} – ${fmtShort(w.dates[6])} ${w.dates[6].slice(0, 4)}${w.file ? ` · from ${w.file}` : ''}`;
    const today = todayISO();
    // Everyone with something on the sheet this week shows, including people on leave all week.
    // The tick box hides those not working at all this week (RDO / leave every day).
    const hideOff = $('mgrOnlyOn').checked;
    const people = w.people.filter((p) => !hideOff || w.dates.some((d) => working(p.days[d])));
    let lastSection = null;
    const rows = people.map((p) => {
      const head = p.section !== lastSection && p.section ? `<tr class="mgr-sec"><td colspan="8">${esc(p.section)}</td></tr>` : '';
      lastSection = p.section;
      return head + `<tr class="${isMe(p) ? 'mine' : ''}"><th scope="row">${nameOf(p)}${p.role ? `<span class="mgr-role">${esc(p.role)}</span>` : ''}</th>${w.dates.map((iso) => {
        const d = p.days[iso] || { events: [] };
        const cls = [iso === today ? 'today' : '', d.off ? 'off' : '', d.off && d.off !== 'RDO' ? 'leave' : '', !working(d) && !d.off ? 'none' : ''].filter(Boolean).join(' ');
        return `<td class="${cls}">${d.off ? `<span class="mgr-offtag" title="${esc(offName(d.off))}">${esc(d.off === 'RDO' ? 'RDO' : offName(d.off))}</span>` : working(d) ? `<b>${esc(timeText(d))}</b>${d.events.map((e) => `<span class="mgr-ev">${esc(e)}</span>`).join('')}` : ''}</td>`;
      }).join('')}</tr>`;
    }).join('');
    $('mgrGrid').innerHTML = `<table><thead><tr><th>Manager</th>${w.dates.map((iso) => `<th class="${iso === today ? 'today' : ''}">${esc(parseISO(iso).toLocaleDateString('en-AU', { weekday: 'short' }))}<span>${parseISO(iso).getDate()}/${parseISO(iso).getMonth() + 1}</span></th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
  }

  function render() { try { renderWin(); renderPanel(); } catch (e) { console.error(e); if (global.__crownShowError) global.__crownShowError(`${e.message} (managers)`); } }

  function open() { ui.week = null; $('mgrDlg').showModal(); renderPanel(); }

  function wire(o) {
    opts = o || {};
    const win = $('mgrWin');
    win.addEventListener('click', open);
    win.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    const step = (n) => { const list = sortedWeeks(), i = list.findIndex((x) => x.weekStart === ui.week); if (list[i + n]) { ui.week = list[i + n].weekStart; renderPanel(); } };
    $('mgrPrev').addEventListener('click', () => step(-1));
    $('mgrNext').addEventListener('click', () => step(1));
    $('mgrThisWeek').addEventListener('click', () => { ui.week = null; renderPanel(); });
    $('mgrOnlyOn').addEventListener('change', renderPanel);
    render();
  }

  /** Forgets weeks that ended before `cutoff` (ISO). Returns the ids removed. */
  function prune(cutoff) {
    const gone = Object.keys(weeks).filter((id) => weeks[id].dates[6] < cutoff);
    gone.forEach((id) => delete weeks[id]);
    if (gone.length) { store(); render(); }
    return gone;
  }

  load();
  global.CrownMgrUI = { wire, add, remove, clear, ids, render, prune, weekFor };
})(window);
