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
  let ui = { view: 'day', date: null, person: '' };

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

  /* Panel: opens on the day (today), with Week to see the whole week. Picking a person shows their
   * roster for the week. ‹ › move a day in Day view, a week otherwise. */
  const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return isoOf(d); };
  const offTag = (d) => `<span class="mgr-offtag" title="${esc(offName(d.off))}">${esc(d.off === 'RDO' ? 'RDO' : offName(d.off))}</span>`;
  const shiftHtml = (d) => (d.off ? offTag(d) : working(d) ? `<b>${esc(timeText(d))}</b>${d.events.map((e) => `<span class="mgr-ev">${esc(e)}</span>`).join('')}` : '<span class="muted">Not rostered</span>');
  const pick = (p) => (p.name ? `<button type="button" class="linkbtn mgr-pick" data-person="${esc(p.name)}" title="See ${esc(p.name)}'s roster">${esc(p.name)}</button>` : nameOf(p));

  function dayHtml(w, iso) {
    const { on, off } = onDay(w, iso);
    const leave = w.people.filter((p) => p.days[iso] && p.days[iso].off && p.name);
    return `<ul class="mgr-day">${on.length ? on.map(({ p, d }) => `<li class="${isMe(p) ? 'mine' : ''}">
        <span class="mgr-t">${esc(timeText(d))}</span>
        <span class="mgr-who">${pick(p)}${p.role ? `<span class="mgr-role">${esc(p.role)}</span>` : ''}</span>
        <span class="mgr-what">${d.events.length ? d.events.map((e) => `<span class="mgr-chip">${esc(e)}</span>`).join('') : ''}</span></li>`).join('')
      : '<li class="empty">No managers rostered this day.</li>'}</ul>`
      + (off.length ? `<p class="mgr-offline"><b>Off:</b> ${leave.map((p) => `${pick(p)} ${offTag(p.days[iso])}`).join(' ')}</p>` : '');
  }

  function weekHtml(w) {
    const today = todayISO();
    // Everyone with something on the sheet this week shows, including people on leave all week.
    const hideOff = $('mgrOnlyOn').checked;
    const people = w.people.filter((p) => !hideOff || w.dates.some((d) => working(p.days[d])));
    let lastSection = null;
    const rows = people.map((p) => {
      const head = p.section !== lastSection && p.section ? `<tr class="mgr-sec"><td colspan="8">${esc(p.section)}</td></tr>` : '';
      lastSection = p.section;
      return head + `<tr class="${isMe(p) ? 'mine' : ''}"><th scope="row">${pick(p)}${p.role ? `<span class="mgr-role">${esc(p.role)}</span>` : ''}</th>${w.dates.map((iso) => {
        const d = p.days[iso] || { events: [] };
        const cls = [iso === today ? 'today' : '', d.off ? 'off' : '', d.off && d.off !== 'RDO' ? 'leave' : ''].filter(Boolean).join(' ');
        return `<td class="${cls}">${d.off ? offTag(d) : working(d) ? shiftHtml(d) : ''}</td>`;
      }).join('')}</tr>`;
    }).join('');
    return `<table><thead><tr><th>Manager</th>${w.dates.map((iso) => `<th class="${iso === today ? 'today' : ''}">${esc(parseISO(iso).toLocaleDateString('en-AU', { weekday: 'short' }))}<span>${parseISO(iso).getDate()}/${parseISO(iso).getMonth() + 1}</span></th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
  }

  function personHtml(w, name) {
    const p = w.people.find((x) => x.name === name);
    if (!p) return `<p class="empty">${esc(name)} isn't on this week's allocation.</p>`;
    const today = todayISO();
    const days = w.dates.filter((iso) => working(p.days[iso])).length;
    return `<div class="mgr-person${isMe(p) ? ' mine' : ''}"><h3>${esc(p.name)}${p.role ? ` <span class="mgr-role">${esc(p.role)}</span>` : ''}</h3>
      <p class="muted small">${days} day${days === 1 ? '' : 's'} rostered this week</p>
      <ul class="mgr-day">${w.dates.map((iso) => { const d = p.days[iso] || { events: [] };
        return `<li class="${iso === today ? 'today' : ''}${d.off ? ' off' : ''}"><span class="mgr-t">${esc(fmtShort(iso))}</span>
          <span class="mgr-who">${d.off ? offTag(d) : working(d) ? `<b>${esc(timeText(d))}</b>` : '<span class="muted">Not rostered</span>'}</span>
          <span class="mgr-what">${!d.off && d.events.length ? d.events.map((e) => `<span class="mgr-chip">${esc(e)}</span>`).join('') : ''}</span></li>`; }).join('')}</ul></div>`;
  }

  function renderPanel() {
    const dlg = $('mgrDlg'); if (!dlg || !dlg.open) return;
    const date = ui.date || todayISO();
    const w = weekFor(date);
    document.querySelectorAll('[data-mgrview]').forEach((b) => b.classList.toggle('on', b.dataset.mgrview === ui.view));
    $('mgrPrev').setAttribute('aria-label', ui.view === 'day' && !ui.person ? 'Previous day' : 'Previous week');
    $('mgrNext').setAttribute('aria-label', ui.view === 'day' && !ui.person ? 'Next day' : 'Next week');
    $('mgrOnlyWrap').hidden = ui.view !== 'week' || !!ui.person;
    // Person list: everyone named on this week's sheet (and whoever is picked, even if not on it).
    const names = [...new Set([...(w ? w.people.map((p) => p.name).filter(Boolean) : []), ...(ui.person ? [ui.person] : [])])];
    $('mgrPerson').innerHTML = '<option value="">Everyone</option>' + names.map((n) => `<option ${n === ui.person ? 'selected' : ''}>${esc(n)}</option>`).join('');
    if (!w) {
      $('mgrRange').textContent = ui.view === 'day' && !ui.person ? fmtDay(date) : `Week of ${fmtShort(addDays(date, -((parseISO(date).getDay() + 6) % 7)))}`;
      $('mgrGrid').innerHTML = `<p class="empty">${ids().length ? 'No manager allocation loaded for this week.' : 'No manager allocation loaded yet.'}</p>`;
      return;
    }
    const range = `${fmtShort(w.dates[0])} – ${fmtShort(w.dates[6])} ${w.dates[6].slice(0, 4)}`;
    if (ui.person) {
      $('mgrRange').textContent = `${ui.person} · ${range}`;
      $('mgrGrid').innerHTML = personHtml(w, ui.person);
    } else if (ui.view === 'week') {
      $('mgrRange').textContent = `${range}${w.file ? ` · from ${w.file}` : ''}`;
      $('mgrGrid').innerHTML = weekHtml(w);
    } else {
      $('mgrRange').textContent = `${fmtDay(date)}${date === todayISO() ? ' · today' : ''}`;
      $('mgrGrid').innerHTML = dayHtml(w, date);
    }
  }

  function render() { try { renderWin(); renderPanel(); } catch (e) { console.error(e); if (global.__crownShowError) global.__crownShowError(`${e.message} (managers)`); } }

  // Opens on today's roster; the week and a person's roster are a click away.
  function open() { ui = { view: 'day', date: null, person: '' }; $('mgrDlg').showModal(); renderPanel(); }

  function wire(o) {
    opts = o || {};
    const win = $('mgrWin');
    win.addEventListener('click', open);
    win.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    const step = (n) => { ui.date = addDays(ui.date || todayISO(), ui.view === 'day' && !ui.person ? n : 7 * n); renderPanel(); };
    $('mgrPrev').addEventListener('click', () => step(-1));
    $('mgrNext').addEventListener('click', () => step(1));
    $('mgrToday').addEventListener('click', () => { ui.date = null; renderPanel(); });
    document.querySelectorAll('[data-mgrview]').forEach((b) => b.addEventListener('click', () => { ui.view = b.dataset.mgrview; ui.person = ''; renderPanel(); }));
    $('mgrPerson').addEventListener('change', (e) => { ui.person = e.target.value; renderPanel(); });
    $('mgrGrid').addEventListener('click', (e) => { const b = e.target.closest('[data-person]'); if (b) { ui.person = b.dataset.person; renderPanel(); } });
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
