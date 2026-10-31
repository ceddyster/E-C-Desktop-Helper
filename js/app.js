(function () {
  'use strict';
  const P = window.CrownParse;
  const $ = (id) => document.getElementById(id);
  const STORE = 'crownDash.v1';
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  /* ---------- State ---------- */
  let state = { sources: [], events: [], shifts: [], myName: '' };
  const view = { selected: P.isoOf(new Date()), month: firstOfMonth(new Date()), onlyMine: false };

  function load() {
    try { const s = JSON.parse(localStorage.getItem(STORE)); if (s) state = Object.assign(state, s); } catch (_) {}
    try { view.onlyMine = localStorage.getItem(STORE + '.onlyMine') === '1'; } catch (_) {}
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (_) { toast('Could not save to this browser — data will reset on reload.'); }
  }

  /* ---------- Helpers ---------- */
  function firstOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function addDays(iso, n) { const d = parseISO(iso); d.setDate(d.getDate() + n); return P.isoOf(d); }
  const todayISO = () => P.isoOf(new Date());
  const fmtLong = (iso) => parseISO(iso).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const fmtShort = (iso) => parseISO(iso).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const byTime = (a, b) => (a.start || '99').localeCompare(b.start || '99') || (a.title || a.person || '').localeCompare(b.title || b.person || '');

  function fmtTime(t) {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
  }
  function isMe(name) {
    const me = state.myName.trim().toLowerCase();
    if (!me || !name) return false;
    const n = String(name).toLowerCase();
    if (n.includes(me) || (me.includes(n) && n.length > 2)) return true;
    // "Cedric" on a sheet matches "Cedric Dos Santos" in settings (single-word names only).
    const a = n.split(/\s+/), b = me.split(/\s+/);
    return (a.length === 1 || b.length === 1) && a[0] === b[0];
  }
  const eventIsMine = (e) => (e.staff || []).some(isMe);

  let toastTimer;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
  }

  function eventsOn(iso) {
    return state.events.filter((e) => e.date === iso && (!view.onlyMine || eventIsMine(e))).sort(byTime);
  }
  function shiftsOn(iso) { return state.shifts.filter((s) => s.date === iso).sort(byTime); }
  // Staff on an event: listed names, plus rostered people whose shift venue/label matches the event.
  function staffFor(e) {
    const names = new Set(e.staff || []);
    if (!names.size) {
      const key = (e.title + ' ' + e.venue).toLowerCase();
      for (const s of shiftsOn(e.date)) {
        const tag = (s.venue || s.label || '').toLowerCase();
        if (tag && tag.length > 2 && key.includes(tag)) names.add(s.person);
      }
    }
    return [...names];
  }

  /* ---------- Rendering ---------- */
  function render() {
    $('todayLabel').textContent = fmtLong(todayISO());
    $('sourceCount').textContent = state.sources.length;
    $('onlyMine').checked = view.onlyMine;
    renderDaily(); renderCalendar(); renderUpcoming();
  }

  function emptyState(msg, withButton) {
    return `<li class="empty">${esc(msg)}${withButton ? '<br><button class="btn primary sm" data-act="load">📂 Load documents</button>' : ''}</li>`;
  }

  function renderDaily() {
    const iso = view.selected, isToday = iso === todayISO();
    $('dailyTitle').textContent = isToday ? 'Today' : fmtShort(iso);
    $('dailyDate').textContent = fmtLong(iso);
    const noData = !state.events.length && !state.shifts.length;

    const evs = eventsOn(iso);
    $('dailyEvents').innerHTML = evs.length ? evs.map((e) => {
      const staff = staffFor(e);
      const meta = [e.venue, e.pax && `${e.pax} pax`].filter(Boolean).map(esc).join(' · ');
      return `<li class="${eventIsMine(e) ? 'mine' : ''}">
        <div class="event-time">${e.start ? fmtTime(e.start) : 'All day'}${e.end ? `<small>to ${fmtTime(e.end)}</small>` : ''}</div>
        <div>
          <div class="event-title">${esc(e.title)}</div>
          ${meta ? `<div class="event-meta">${meta}</div>` : ''}
          ${e.notes ? `<div class="event-meta">${esc(e.notes)}</div>` : ''}
          <div class="chips">${staff.length ? staff.map((n) => `<span class="chip ${isMe(n) ? 'me' : ''}">${esc(n)}</span>`).join('') : '<span class="chip none">No staff listed</span>'}</div>
        </div></li>`;
    }).join('') : emptyState(noData ? 'No documents loaded yet.' : 'No events on this day.', noData);

    const sh = shiftsOn(iso);
    $('dailyShifts').innerHTML = sh.length ? sh.map((s) => `<li class="${isMe(s.person) ? 'mine' : ''}">
        <span class="who">${esc(s.person)}${s.role ? ` <span class="muted small">${esc(s.role)}</span>` : ''}</span>
        <span class="when">${s.start ? `${fmtTime(s.start)}${s.end ? '–' + fmtTime(s.end) : ''}` : esc(s.label)}</span></li>`).join('')
      : emptyState(state.shifts.length ? 'Nobody rostered.' : 'Load a roster to see who\'s on.');
  }

  function renderCalendar() {
    const m = view.month;
    $('calMonth').textContent = m.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
    const start = new Date(m); start.setDate(1 - ((m.getDay() + 6) % 7)); // Monday-first
    let html = DOW.map((d) => `<div class="dow">${d}</div>`).join('');
    const today = todayISO();
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const iso = P.isoOf(d);
      if (i === 35 && d.getMonth() !== m.getMonth()) break; // drop empty 6th row
      const evs = eventsOn(iso);
      const myShift = shiftsOn(iso).find((s) => isMe(s.person));
      const cls = ['day', d.getMonth() !== m.getMonth() && 'other', iso === today && 'today', iso === view.selected && 'selected'].filter(Boolean).join(' ');
      html += `<button type="button" class="${cls}" data-date="${iso}" aria-label="${fmtLong(iso)}, ${evs.length} events">
        <span class="num">${d.getDate()}</span>
        ${myShift ? `<span class="shiftdot">● On ${myShift.start ? fmtTime(myShift.start) : esc(myShift.label)}</span>` : ''}
        ${evs.slice(0, 3).map((e) => `<span class="ev ${eventIsMine(e) ? 'mine' : ''}" title="${esc(e.title)}">${e.start ? fmtTime(e.start) + ' ' : ''}${esc(e.title)}</span>`).join('')}
        ${evs.length > 3 ? `<span class="more">+${evs.length - 3} more</span>` : ''}
      </button>`;
    }
    $('calGrid').innerHTML = html;
  }

  function renderUpcoming() {
    const items = [];
    for (let i = 0; i < 7; i++) {
      const iso = addDays(todayISO(), i);
      for (const e of eventsOn(iso)) items.push(e);
    }
    $('upcomingList').innerHTML = items.length ? items.map((e) => `<li data-date="${e.date}">
      <div class="u-date">${fmtShort(e.date)}${e.start ? ' · ' + fmtTime(e.start) : ''}</div>
      <div class="u-title ${eventIsMine(e) ? 'mine' : ''}">${esc(e.title)}</div>
      ${e.venue ? `<div class="u-date">${esc(e.venue)}</div>` : ''}</li>`).join('')
      : emptyState(view.onlyMine ? 'Nothing of yours this week.' : 'Nothing in the next 7 days.');
  }

  function selectDate(iso) {
    view.selected = iso;
    const d = parseISO(iso);
    if (d.getMonth() !== view.month.getMonth() || d.getFullYear() !== view.month.getFullYear()) view.month = firstOfMonth(d);
    render();
  }

  /* ---------- Import flow ---------- */
  let pending = []; // [{fileName, sheets:[analysed]}]

  async function handleFiles(files) {
    pending = [];
    const errors = [];
    for (const f of files) {
      try {
        const sheets = await P.readFile(f.name, f.buf);
        pending.push({ fileName: f.name, sheets });
      } catch (e) { errors.push(`${f.name}: ${e.message}`); }
    }
    if (errors.length) toast(errors.join(' · '));
    if (pending.length) openImport();
  }

  const KIND_LABEL = { events: 'Events / functions', roster: 'Roster (one row per shift)', grid: 'Roster (names × days grid)', skip: 'Skip this sheet' };
  const FIELD_LABEL = {
    events: { date: 'Date', start: 'Start time (or time range)', end: 'End time', title: 'Event name', venue: 'Venue / room', staff: 'Staff / manager', staff2: 'Staff (2nd column)', pax: 'Pax', notes: 'Notes' },
    roster: { date: 'Date', person: 'Person', start: 'Start (or shift)', end: 'End', role: 'Role', venue: 'Venue / area' },
    grid: { person: 'Person column', role: 'Role column' },
  };

  function openImport() {
    const list = $('importList');
    list.innerHTML = '';
    pending.forEach((file, fi) => file.sheets.forEach((sh, si) => {
      const div = document.createElement('div');
      div.className = 'imp'; div.dataset.f = fi; div.dataset.s = si;
      list.appendChild(div);
      renderImportItem(div, file, sh);
    }));
    $('importDlg').showModal();
  }

  function renderImportItem(div, file, sh) {
    const name = file.fileName + (sh.label ? ` › ${sh.label}` : '');
    if (sh.kind === 'ready') {
      const r = sh.ready;
      div.innerHTML = `<div class="imp-head"><strong>${esc(name)}</strong><span class="muted small">${r.events.length} events, ${r.shifts.length} shifts</span></div>${previewTable(r)}${warn(r.warnings)}`;
      return;
    }
    const kinds = ['events', 'roster', 'grid', 'skip'].map((k) => `<option value="${k}" ${k === sh.kind ? 'selected' : ''}>${KIND_LABEL[k]}</option>`).join('');
    const colOpts = (sel) => `<option value="">—</option>` + sh.headers.map((h, i) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${esc(h || `Column ${i + 1}`)}</option>`).join('');
    const fields = FIELD_LABEL[sh.kind] || {};
    const result = sh.kind === 'skip' ? null : P.build(sh);
    div.innerHTML = `
      <div class="imp-head"><strong>${esc(name)}</strong>
        <select data-role="kind" aria-label="Sheet type">${kinds}</select></div>
      ${sh.kind === 'skip' ? '<p class="muted small">This sheet will be ignored.</p>' : `
      <div class="map">${Object.entries(fields).map(([f, lbl]) => `<label>${lbl}<select data-field="${f}">${colOpts(sh.mapping[f])}</select></label>`).join('')}</div>
      ${previewTable(result)}${warn(result.warnings)}`}`;
    div.querySelector('[data-role="kind"]').onchange = (ev) => {
      sh.kind = ev.target.value;
      if (sh.kind === 'grid' && sh.dateCols.length < 3) sh.dateCols = sh.headers.map((h, i) => (P.toISODate(h) ? i : -1)).filter((i) => i >= 0);
      renderImportItem(div, file, sh);
    };
    div.querySelectorAll('[data-field]').forEach((sel) => sel.onchange = () => {
      const v = sel.value; sh.mapping[sel.dataset.field] = v === '' ? null : +v;
      renderImportItem(div, file, sh);
    });
  }

  const warn = (w) => (w && w.length ? `<p class="warn">${w.map(esc).join('<br>')}</p>` : '');

  function previewTable(r) {
    if (!r) return '';
    if (r.events.length) {
      const rows = r.events.slice(0, 5).map((e) => `<tr><td>${fmtShort(e.date)}</td><td>${fmtTime(e.start)}${e.end ? '–' + fmtTime(e.end) : ''}</td><td>${esc(e.title)}</td><td>${esc(e.venue)}</td><td>${esc((e.staff || []).join(', '))}</td></tr>`).join('');
      return `<div class="preview"><table><tr><th>Date</th><th>Time</th><th>Event</th><th>Venue</th><th>Staff</th></tr>${rows}</table><p class="muted small">${r.events.length} events found${r.events.length > 5 ? ' (first 5 shown)' : ''}</p></div>`;
    }
    if (r.shifts.length) {
      const rows = r.shifts.slice(0, 5).map((s) => `<tr><td>${fmtShort(s.date)}</td><td>${esc(s.person)}</td><td>${s.start ? fmtTime(s.start) + (s.end ? '–' + fmtTime(s.end) : '') : esc(s.label)}</td><td>${esc(s.role)}</td></tr>`).join('');
      return `<div class="preview"><table><tr><th>Date</th><th>Person</th><th>Shift</th><th>Role</th></tr>${rows}</table><p class="muted small">${r.shifts.length} shifts found${r.shifts.length > 5 ? ' (first 5 shown)' : ''}</p></div>`;
    }
    return '';
  }

  function commitImport() {
    let ne = 0, ns = 0;
    for (const file of pending) {
      const id = 'src:' + file.fileName.toLowerCase();
      removeSource(id, true);
      const events = [], shifts = [];
      for (const sh of file.sheets) {
        if (sh.kind === 'skip') continue;
        const r = sh.kind === 'ready' ? sh.ready : P.build(sh);
        events.push(...r.events); shifts.push(...r.shifts);
      }
      events.forEach((e, i) => { e.id = `${id}#e${i}`; e.source = id; });
      shifts.forEach((s, i) => { s.id = `${id}#s${i}`; s.source = id; });
      state.events.push(...events); state.shifts.push(...shifts);
      state.sources.push({ id, name: file.fileName, loadedAt: new Date().toISOString(), events: events.length, shifts: shifts.length });
      ne += events.length; ns += shifts.length;
    }
    pending = [];
    save(); render();
    toast(`Imported ${ne} events and ${ns} shifts.`);
  }

  function removeSource(id, silent) {
    state.sources = state.sources.filter((s) => s.id !== id);
    state.events = state.events.filter((e) => e.source !== id);
    state.shifts = state.shifts.filter((s) => s.source !== id);
    if (!silent) { save(); render(); renderSources(); }
  }

  function renderSources() {
    $('sourceList').innerHTML = state.sources.length ? state.sources.map((s) => `<li>
      <div><div>${esc(s.name)}</div><div class="meta">${s.events} events · ${s.shifts} shifts · loaded ${new Date(s.loadedAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}</div></div>
      <button class="btn sm danger" type="button" data-remove="${esc(s.id)}">Remove</button></li>`).join('')
      : '<li class="empty">No documents loaded.</li>';
  }

  /* ---------- Sample data ---------- */
  function loadSample() {
    const t = todayISO();
    const names = ['Alex Chen', 'Priya Nair', 'Sam Walker', 'Jordan Lee', 'Mia Rossi', state.myName || 'You'];
    const venues = ['Grand Ballroom', 'Astral Ballroom', 'Crown Theatre Foyer', 'Riverside Room', 'Pavilion Terrace', 'Lounge 3'];
    const titles = ['Corporate Gala Dinner', 'Wedding Reception', 'Mining Conference Day', 'Charity Lunch', 'Product Launch', 'Awards Night', 'Board Breakfast', 'Cocktail Function'];
    const events = [], shifts = [];
    for (let d = -3; d < 35; d++) {
      const iso = addDays(t, d);
      const n = (d * 7 + 3) % 3;
      for (let k = 0; k <= n; k++) {
        const i = Math.abs(d * 3 + k * 5);
        const h = [7, 11, 18][k % 3];
        events.push({ date: iso, start: `${String(h).padStart(2, '0')}:00`, end: `${String(h + 4).padStart(2, '0')}:00`,
          title: titles[i % titles.length], venue: venues[(i + k) % venues.length], pax: String(80 + (i % 9) * 40), notes: '',
          staff: [names[i % names.length], names[(i + 2) % names.length]] });
      }
      names.forEach((p, j) => { if ((d + j) % 4 !== 0) shifts.push({ date: iso, person: p, start: j % 2 ? '14:00' : '06:30', end: j % 2 ? '23:00' : '15:00', label: '', role: j < 2 ? 'Event Manager' : 'Supervisor', venue: '' }); });
    }
    pending = [{ fileName: 'Sample data (demo)', sheets: [{ label: '', kind: 'ready', ready: { events, shifts, warnings: [] } }] }];
    commitImport();
    $('sourcesDlg').close();
  }

  /* ---------- Wiring ---------- */
  function pickLocal() { $('fileInput').value = ''; $('fileInput').click(); }

  function wire() {
    $('btnLoad').onclick = pickLocal;
    $('fileInput').onchange = async (e) => {
      const files = await Promise.all([...e.target.files].map(async (f) => ({ name: f.name, buf: await f.arrayBuffer() })));
      handleFiles(files);
    };
    if (window.CrownDrive && window.CrownDrive.enabled) {
      $('btnDrive').hidden = false;
      $('btnDrive').onclick = async () => {
        try { const files = await window.CrownDrive.pick(); if (files.length) handleFiles(files); }
        catch (e) { toast('Google Drive: ' + e.message); }
      };
    }
    $('btnImport').onclick = () => commitImport();
    $('importDlg').addEventListener('close', () => { pending = []; });

    $('btnSources').onclick = () => { renderSources(); $('sourcesDlg').showModal(); };
    $('sourceList').onclick = (e) => { const b = e.target.closest('[data-remove]'); if (b) removeSource(b.dataset.remove); };
    $('btnClear').onclick = () => {
      if (!confirm('Remove all loaded documents from this dashboard?')) return;
      state.sources = []; state.events = []; state.shifts = []; save(); render(); renderSources();
    };
    $('btnSample').onclick = loadSample;

    $('btnSettings').onclick = () => { $('myName').value = state.myName; $('settingsDlg').showModal(); };
    $('btnSaveSettings').onclick = () => { state.myName = $('myName').value.trim(); save(); render(); };

    $('dayPrev').onclick = () => selectDate(addDays(view.selected, -1));
    $('dayNext').onclick = () => selectDate(addDays(view.selected, 1));
    $('dayToday').onclick = () => selectDate(todayISO());
    $('calPrev').onclick = () => { view.month = new Date(view.month.getFullYear(), view.month.getMonth() - 1, 1); render(); };
    $('calNext').onclick = () => { view.month = new Date(view.month.getFullYear(), view.month.getMonth() + 1, 1); render(); };
    $('onlyMine').onchange = (e) => {
      view.onlyMine = e.target.checked;
      try { localStorage.setItem(STORE + '.onlyMine', view.onlyMine ? '1' : '0'); } catch (_) {}
      if (view.onlyMine && !state.myName) toast('Set your name in ⚙︎ Settings so I know which events are yours.');
      render();
    };

    document.addEventListener('click', (e) => {
      const d = e.target.closest('[data-date]'); if (d) { selectDate(d.dataset.date); if (d.closest('#upcomingList')) $('dailyTitle').scrollIntoView({ behavior: 'smooth' }); }
      if (e.target.closest('[data-act="load"]')) pickLocal();
    });

    // Drag & drop files anywhere on the page.
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', async (e) => {
      e.preventDefault();
      const files = await Promise.all([...e.dataTransfer.files].map(async (f) => ({ name: f.name, buf: await f.arrayBuffer() })));
      if (files.length) handleFiles(files);
    });

    // Roll over to the new day if the page is left open overnight.
    let lastDay = todayISO();
    setInterval(() => { const t = todayISO(); if (t !== lastDay) { if (view.selected === lastDay) view.selected = t; lastDay = t; render(); } }, 60000);
  }

  load(); wire(); render();
})();
