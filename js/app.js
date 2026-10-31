(function () {
  'use strict';
  const P = window.CrownParse;
  const $ = (id) => document.getElementById(id);
  const STORE = 'crownDash.v1';
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  /* ---------- State ---------- */
  let state = { sources: [], events: [], shifts: [], myName: '' };
  const view = { selected: P.isoOf(new Date()), month: firstOfMonth(new Date()), onlyMine: false, calMode: 'shifts' };

  function load() {
    try { const s = JSON.parse(localStorage.getItem(STORE)); if (s) state = Object.assign(state, s); } catch (_) {}
    delete state.tl;
    try { view.onlyMine = localStorage.getItem(STORE + '.onlyMine') === '1'; } catch (_) {}
    try { view.calMode = localStorage.getItem(STORE + '.calMode') || 'shifts'; } catch (_) {}
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
  const eventIsMine = (e) => (e.staff || []).some(isMe) || isMe(e.manager) || (e.barStaff || []).some((d) => isMe(d.name));

  let toastTimer;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
  }

  /* BEOs are the events. The TL sheet's Duties column names the event each bar team works,
   * so TL groups are attached to the BEO with the same name on the same day. TL duties with
   * no matching BEO still show, flagged, so a name mismatch is easy to spot. */
  const M = window.CrownMatch;
  // Manual corrections: "date|duty" → BEO source id, or 'none' to keep the TL duty separate.
  const linkKey = (date, duty) => `${date}|${M.key(duty)}`;
  function dayEvents(iso) {
    const all = state.events.filter((e) => e.date === iso);
    const main = all.filter((e) => !e.fromTL).map((e) => Object.assign({}, e, { barStaff: [], barNotes: [], bars: [], tlDuties: [] }));
    const beos = main.filter((b) => b.beo);
    const out = [...main];
    for (const t of all.filter((e) => e.fromTL)) {
      const manual = (state.links || {})[linkKey(iso, t.title)];
      const m = manual ? (manual === 'none' ? null : beos.find((b) => b.id === manual) || null)
        : M.best(t.title, t.bars, beos);
      if (m) {
        m.barStaff.push(...(t.staffDetail || []));
        m.bars = [...new Set([...m.bars, ...(t.bars || [])])];
        if (t.notes) m.barNotes.push(t.notes);
        m.manager = m.manager || t.manager;
        m.tlDuties.push({ duty: t.title, manual: !!manual });
      } else {
        out.push(Object.assign({}, t, { barStaff: t.staffDetail || [], barNotes: t.notes ? [t.notes] : [], noBEO: true, beoChoices: beos.length, manualNone: manual === 'none' }));
      }
    }
    return out.sort(byTime);
  }
  function setLink(date, duty, value) {
    state.links = state.links || {};
    if (value === '') delete state.links[linkKey(date, duty)]; else state.links[linkKey(date, duty)] = value;
    save(); render();
  }
  function linkPicker(date, duty, current) {
    const beos = state.events.filter((e) => e.date === date && e.beo);
    return `<select class="link-pick" data-link-date="${esc(date)}" data-link-duty="${esc(duty)}" aria-label="Which BEO is ${esc(duty)}?">
      <option value="">Automatic</option>
      ${beos.map((b) => `<option value="${esc(b.id)}" ${current === b.id ? 'selected' : ''}>${esc(b.title)}${b.subtitle ? ' · ' + esc(b.subtitle) : ''}</option>`).join('')}
      <option value="none" ${current === 'none' ? 'selected' : ''}>Not on a BEO (keep separate)</option>
    </select>`;
  }
  function eventsOn(iso) { return dayEvents(iso).filter((e) => !view.onlyMine || eventIsMine(e)); }
  function shiftsOn(iso) { return state.shifts.filter((s) => s.date === iso).sort(byTime); }
  function calShiftsOn(iso) { return shiftsOn(iso).filter((s) => !view.onlyMine || isMe(s.person)); }
  // "Leisly Tuesta Melendez" → "Leisly T." to fit calendar cells.
  const shortName = (n) => { const p = String(n).trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[1][0]}.` : p[0]; };
  const shiftWhen = (s) => (s.start ? fmtTime(s.start) + (s.end ? '–' + fmtTime(s.end) : '') : s.label || '');
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
    $('dailyEvents').innerHTML = evs.length ? evs.map(eventCard).join('') : emptyState(noData ? 'No documents loaded yet.' : 'No events on this day.', noData);

    const sh = shiftsOn(iso);
    $('dailyShifts').innerHTML = sh.length ? sh.map((s) => `<li class="${isMe(s.person) ? 'mine' : ''}">
        <span class="who">${esc(s.person)}${s.role ? ` <span class="muted small">${esc(s.role)}</span>` : ''}${s.duty ? `<br><span class="muted small">${esc(s.duty)}</span>` : ''}</span>
        <span class="when">${s.start ? `${fmtTime(s.start)}${s.end ? '–' + fmtTime(s.end) : ''}` : esc(s.label)}</span></li>`).join('')
      : emptyState(state.shifts.length ? 'Nobody rostered.' : 'Load a roster to see who\'s on.');
  }

  function eventCard(e) {
    const b = e.beo;
    const sub = [b && b.beoName, b && b.number && `BEO #${b.number}`, b && b.eventManager && `EM: ${b.eventManager}`].filter(Boolean).map(esc).join(' · ');
    const meta = [e.venue && !e.noBEO ? e.venue : '', e.pax && `${e.pax} guests`].filter(Boolean).map(esc).join(' · ');
    const barLine = [e.bars && e.bars.length && `Bar: ${e.bars.join(' / ')}`, e.manager && `Manager: ${e.manager}`].filter(Boolean).map(esc).join(' · ');
    let chips;
    if (e.barStaff && (e.barStaff.length || b)) {
      chips = e.barStaff.length
        ? e.barStaff.map((d) => `<span class="chip ${isMe(d.name) ? 'me' : ''}">${esc(d.name)}${d.start ? ` <b>${fmtTime(d.start)}</b>` : ''}${d.bar && e.bars.length > 1 ? ` · ${esc(d.bar)}` : ''}</span>`).join('')
        : '<span class="chip none">No bar staff on the TL sheet</span>';
    } else {
      const staff = staffFor(e);
      chips = staff.length ? staff.map((n) => `<span class="chip ${isMe(n) ? 'me' : ''}">${esc(n)}</span>`).join('') : '<span class="chip none">No staff listed</span>';
    }
    const fns = b && b.functions && b.functions.length ? `<details class="more-info"><summary>Function times</summary><table>${b.functions.map((f) =>
      `<tr><td>${f.start ? fmtTime(f.start) + '–' + fmtTime(f.end) : ''}</td><td>${esc(f.event)}</td><td>${esc(f.venue)}</td><td>${f.gtd ? f.gtd + ' gtd' : ''}</td></tr>`).join('')}</table></details>` : '';
    const bev = b && b.beverage && b.beverage.length ? `<details class="more-info"><summary>Beverage</summary><ul>${b.beverage.map((l) =>
      /^\d{1,2}:\d{2}\s*-/.test(l) ? `<li class="sub">${esc(l)}</li>` : `<li>${esc(l)}</li>`).join('')}</ul></details>` : '';
    return `<li class="${eventIsMine(e) ? 'mine' : ''} ${e.noBEO ? 'nobeo' : ''}">
      <div class="event-time">${e.start ? fmtTime(e.start) : 'All day'}${e.end ? `<small>to ${fmtTime(e.end)}</small>` : ''}</div>
      <div>
        <div class="event-title">${esc(e.title)}${e.noBEO ? ` <span class="tag">${e.manualNone ? 'TL only' : 'TL only · no matching BEO'}</span>` : ''}</div>
        ${e.noBEO && e.beoChoices ? `<div class="event-meta">Is this one of today's BEOs? ${linkPicker(e.date, e.title, e.manualNone ? 'none' : '')}</div>` : ''}
        ${e.tlDuties && e.tlDuties.length ? `<div class="event-meta tl-from">TL: ${e.tlDuties.map((d) => `“${esc(d.duty)}”${d.manual ? ' (linked by you)' : ''} <button class="linkbtn" type="button" data-change-link="${esc(d.duty)}" data-link-date="${esc(e.date)}">change</button>`).join(', ')}</div>` : ''}
        ${sub ? `<div class="event-meta">${sub}</div>` : ''}
        ${meta ? `<div class="event-meta">${meta}</div>` : ''}
        ${barLine ? `<div class="event-meta">${barLine}</div>` : ''}
        ${(e.barNotes || []).concat(e.barStaff ? [] : [e.notes]).filter(Boolean).map((n) => `<div class="event-meta note">${esc(n)}</div>`).join('')}
        <div class="chips">${chips}</div>
        ${fns}${bev}
      </div></li>`;
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
      const shs = calShiftsOn(iso);
      const myShift = shiftsOn(iso).find((s) => isMe(s.person));
      const showShifts = view.calMode === 'shifts' && state.shifts.length;
      const items = showShifts
        ? shs.map((s) => `<span class="sh ${isMe(s.person) ? 'mine' : ''}" title="${esc(s.person)} · ${esc(shiftWhen(s))}${s.venue ? ' · ' + esc(s.venue) : ''}"><b>${esc(shiftWhen(s))}</b> ${esc(shortName(s.person))}${s.venue ? `<br><span class="muted">${esc(s.venue)}</span>` : ''}</span>`)
        : evs.map((e) => `<span class="ev ${eventIsMine(e) ? 'mine' : ''}" title="${esc(e.title)}">${e.start ? fmtTime(e.start) + ' ' : ''}${esc(e.title)}</span>`);
      const cls = ['day', d.getMonth() !== m.getMonth() && 'other', iso === today && 'today', iso === view.selected && 'selected'].filter(Boolean).join(' ');
      html += `<button type="button" class="${cls}" data-date="${iso}" aria-label="${fmtLong(iso)}, ${shs.length} shifts, ${evs.length} events">
        <span class="num">${d.getDate()}</span>
        ${myShift && !showShifts ? `<span class="shiftdot">● On ${myShift.start ? fmtTime(myShift.start) : esc(myShift.label)}</span>` : ''}
        ${items.slice(0, 4).join('')}
        ${items.length > 4 ? `<span class="more">+${items.length - 4} more</span>` : ''}
      </button>`;
    }
    $('calGrid').innerHTML = html;
    document.querySelectorAll('[data-calmode]').forEach((b) => b.classList.toggle('on', b.dataset.calmode === view.calMode));
  }

  function renderUpcoming() {
    if (view.calMode === 'shifts' && state.shifts.length) {
      const rows = [];
      for (let i = 0; i < 7; i++) {
        const iso = addDays(todayISO(), i), shs = calShiftsOn(iso);
        if (shs.length) rows.push(`<li data-date="${iso}"><div class="u-date">${fmtShort(iso)} · ${shs.length} on shift</div>${shs.map((s) =>
          `<div class="u-title ${isMe(s.person) ? 'mine' : ''}">${esc(shiftWhen(s))} ${esc(s.person)}${s.venue ? ` <span class="u-date">${esc(s.venue)}</span>` : ''}</div>`).join('')}</li>`);
      }
      $('upcomingList').innerHTML = rows.join('') || emptyState('No shifts in the next 7 days.');
      return;
    }
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

  /** Reads one file into an import entry. `auto` = safe to import without review (TL, BEO, .ics). */
  async function prepare(name, buf) {
    const sheets = await P.readFile(name, buf);
    const first = sheets[0] || {};
    if (first.isTL) {
      // TL workbooks are weekly ("TL 26.10.2026-1.11.2026.xlsx"): one source per week, and a
      // re-download of the same week ("… (1).xlsx") replaces it.
      const week = name.replace(/\.[a-z0-9]+$/i, '').replace(/\s*\(\d+\)\s*$/, '').trim();
      return { fileName: name, sheets, sourceId: 'src:tl:' + week.toLowerCase(), displayName: week, auto: true };
    }
    if (first.isBEO && first.beoNumber) {
      // A revised BEO ("… (6).pdf") replaces the earlier version with the same BEO number.
      return { fileName: name, sheets, sourceId: 'src:beo:' + first.beoNumber, displayName: first.label, auto: true };
    }
    return { fileName: name, sheets, auto: /\.ics$/i.test(name) };
  }

  async function handleFiles(files) {
    pending = [];
    const errors = [];
    for (const f of files) {
      try { pending.push(await prepare(f.name, f.buf)); } catch (e) { errors.push(`${f.name}: ${e.message}`); }
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
    const dates = commitEntries(pending);
    const jump = dates.find((d) => d >= todayISO()) || dates[0];
    pending = [];
    save();
    if (jump) selectDate(jump); else render();
  }

  /** Stores entries (replacing earlier data from the same source). Returns their dates, sorted. */
  function commitEntries(entries, quiet) {
    let ne = 0, ns = 0;
    const dates = [];
    for (const file of entries) {
      const id = file.sourceId || 'src:' + file.fileName.toLowerCase();
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
      state.sources.push({ id, name: file.displayName || file.fileName, loadedAt: new Date().toISOString(), events: events.length, shifts: shifts.length, fromFolder: !!file.fromFolder });
      ne += events.length; ns += shifts.length;
      events.concat(shifts).forEach((x) => x.date && dates.push(x.date));
    }
    if (!quiet) toast(`Imported ${ne} events and ${ns} shifts.`);
    return dates.sort();
  }

  /* ---------- Linked folder ---------- */
  const F = window.CrownFolder;
  const folderName = () => (folderHandle && folderHandle.name) || 'linked folder';
  let folderHandle = null, folderPerm = '', scanning = false;
  const FIRST_SCAN_DAYS = 60;   // on first link, ignore files untouched for longer than this

  async function initFolder() {
    if (!F || !F.supported) return;
    $('btnFolder').hidden = false;
    folderHandle = await F.saved();
    if (folderHandle) {
      try { folderPerm = await F.permission(folderHandle, false); } catch (_) { folderPerm = 'prompt'; }
      if (folderPerm === 'granted') scanFolder(false);
    }
    renderFolder();
  }

  async function linkFolder() {
    if (!F || !F.supported) { toast('Linking a folder needs Microsoft Edge or Google Chrome.'); return; }
    try { folderHandle = await F.pick(); } catch (e) { if (e.name !== 'AbortError') toast('Couldn\'t link that folder: ' + e.message); return; }
    folderPerm = 'granted';
    state.folder = { name: folderName(), seen: {}, lastScan: null, files: {}, readerVersion: READER_VERSION };
    save();
    if ($('sourcesDlg').open) renderSources();
    await scanFolder(true);
  }

  async function reconnectFolder() {
    try { folderPerm = await F.permission(folderHandle, true); } catch (_) { folderPerm = 'denied'; }
    renderFolder();
    if (folderPerm === 'granted') scanFolder(true);
    else toast('The browser didn\'t allow access to the folder.');
  }

  async function unlinkFolder() {
    await F.forget();
    folderHandle = null; folderPerm = ''; delete state.folder; save(); renderFolder(); renderSources();
  }

  /** Imports TL Sheets / BEOs that are new or changed since the last check. */
  // Bump when the TL/BEO readers improve, so files skipped by an older version get read again.
  const READER_VERSION = 2;
  const pause = () => new Promise((r) => setTimeout(r, 0));
  let scanProgress = '';

  async function scanFolder(verbose) {
    if (scanning || !folderHandle || folderPerm !== 'granted') return;
    scanning = true; scanProgress = ''; renderFolder();
    const st = state.folder || (state.folder = { name: folderName(), seen: {} });
    if (st.readerVersion !== READER_VERSION) { st.seen = {}; st.readerVersion = READER_VERSION; }
    st.files = st.files || {};
    let loadedNow = 0;
    try {
      const files = await F.list(folderHandle);
      const present = new Set(files.map((f) => f.path));
      for (const k of Object.keys(st.files)) if (!present.has(k)) delete st.files[k];
      const cutoff = Date.now() - FIRST_SCAN_DAYS * 864e5;
      const todo = [];
      for (const f of files) {
        if (f.target !== undefined) {
          st.files[f.path] = { status: 'shortcut', detail: f.target, site: F.sharePointSite(f.target) };
          continue;
        }
        if (f.error) { st.files[f.path] = { status: 'error', detail: `couldn't open (${f.error}). If it shows a cloud icon in File Explorer, right-click → Always keep on this device.` }; continue; }
        if (st.seen[f.path] === f.lastModified) continue;
        // Spreadsheets (TL Sheets) are always read. PDFs untouched for 60+ days are left out to keep things quick.
        if (/\.(pdf|ics)$/i.test(f.name) && st.seen[f.path] == null && f.lastModified < cutoff) {
          st.files[f.path] = { status: 'old', detail: `not changed in ${FIRST_SCAN_DAYS}+ days` };
          continue;
        }
        todo.push(f);
      }
      todo.sort((a, b) => a.lastModified - b.lastModified);   // oldest first, so the newest version wins
      let batch = [];
      const flush = () => { if (batch.length) { commitEntries(batch, true); loadedNow += batch.length; batch = []; save(); render(); } };
      for (let n = 0; n < todo.length; n++) {
        const f = todo[n];
        scanProgress = `${n + 1}/${todo.length}`; renderFolder();
        await pause();
        try {
          const entry = await prepare(f.name, await f.file.arrayBuffer());
          if (entry.auto) {
            entry.fromFolder = true; batch.push(entry);
            const r = entry.sheets[0].ready || { events: [], shifts: [] };
            st.files[f.path] = { status: 'loaded', detail: entry.sheets[0].isTL ? `${r.shifts.length} bar shifts` : `${r.events.length} event${r.events.length === 1 ? '' : 's'}` };
          } else {
            st.files[f.path] = { status: 'skipped', detail: 'not a TL Sheet (no bar tabs) or BEO' };
          }
          st.seen[f.path] = f.lastModified;
        } catch (e) {
          // Not marked as seen, so it's tried again next time (e.g. a file still syncing).
          st.files[f.path] = { status: 'error', detail: e.message };
        }
        if (batch.length >= 8) flush();
      }
      flush();
      st.lastScan = new Date().toISOString();
      st.found = files.length;
      st.name = folderName();
      save(); render();
      const shortcuts = Object.values(st.files).filter((v) => v.status === 'shortcut').length;
      if (!loadedNow && shortcuts) toast(`📁 This folder holds ${shortcuts} shortcut${shortcuts === 1 ? '' : 's'} (.url), not the files. Open Documents to see how to fix it.`);
      else if (loadedNow) toast(`📁 ${loadedNow} new or updated document${loadedNow === 1 ? '' : 's'} loaded from ${folderName()}.`);
      else if (verbose) toast(files.length ? `📁 ${folderName()} checked. Nothing new. See Documents for details.` : `📁 No spreadsheets or PDFs found in ${folderName()}.`);
    } catch (e) {
      if (e.name === 'NotAllowedError' || e.name === 'SecurityError') folderPerm = 'prompt';
      else if (e.name === 'NotFoundError') toast('📁 The linked folder can\'t be found. Was it moved or renamed? Link it again.');
      else toast('📁 Folder check failed: ' + e.message);
    } finally {
      scanning = false; scanProgress = ''; save(); renderFolder();
    }
  }

  async function rereadFolder() {
    if (state.folder) state.folder.seen = {};
    await scanFolder(true);
  }

  function renderFolder() {
    const btn = $('btnFolder');
    if (!btn || btn.hidden) return;
    const st = state.folder;
    btn.classList.toggle('warn', !!folderHandle && folderPerm !== 'granted');
    if (!folderHandle) { btn.textContent = '📁 Link folder'; btn.title = 'Link a folder (e.g. your synced SharePoint library) and new TL Sheets and BEOs load automatically'; }
    else if (folderPerm !== 'granted') { btn.textContent = `📁 Reconnect ${folderName()}`; btn.title = 'The browser needs your OK again to read this folder'; }
    else {
      btn.textContent = scanning ? `📁 Checking${scanProgress ? ' ' + scanProgress : '…'}` : `📁 ${folderName()}`;
      btn.title = `Linked folder. ${st && st.lastScan ? 'Last checked ' + new Date(st.lastScan).toLocaleTimeString('en-AU', { timeStyle: 'short' }) + '. ' : ''}Click to check for new documents now.`;
    }
    const panel = $('folderPanel');
    if (!panel) return;
    if (!F || !F.supported) { panel.innerHTML = '<p class="muted small">Linking a folder needs Microsoft Edge or Google Chrome.</p>'; return; }
    if (!folderHandle) {
      panel.innerHTML = `<div class="folder-box"><strong>No folder linked</strong>
        <p class="muted small">Link the folder where TL Sheets and BEOs are saved, such as a SharePoint library synced to File Explorer. New or updated files load automatically.</p>
        <div class="row"><button class="btn primary sm" type="button" data-folder="link">📁 Link folder</button></div></div>`;
      return;
    }
    const files = Object.entries((st && st.files) || {}).sort((a, b) => a[0].localeCompare(b[0]));
    const group = (k) => files.filter(([, v]) => v.status === k);
    const LABEL = { loaded: 'Loaded', error: 'Couldn\'t read', skipped: 'Not a TL Sheet or BEO', old: 'Older PDFs not checked', shortcut: 'Shortcuts (.url): can\'t be read' };
    const summary = ['loaded', 'error', 'shortcut', 'skipped', 'old'].map((k) => [k, group(k)]).filter(([, g]) => g.length);
    // Shortcuts only hold a web address. Point at the SharePoint site(s) they lead to, so the real
    // library can be synced to File Explorer and linked instead.
    const sites = [...new Set(group('shortcut').map(([, v]) => v.site).filter(Boolean))];
    const shortcutHelp = group('shortcut').length ? `<div class="shortcut-help">
        <strong>This folder has shortcuts (.url), not the actual files.</strong>
        <p>A shortcut only stores a web address, and the browser can't open SharePoint files from it. To link the real files:</p>
        <ol>
          <li>Open the SharePoint site the shortcuts point to${sites.length ? ':' : '.'}
            ${sites.map((u) => `<br><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u.replace(/^https:\/\//, ''))} ↗</a>`).join('')}</li>
          <li>Go to the document library or folder that holds the TL Sheets (e.g. <b>Documents</b>).</li>
          <li>Click <b>Sync</b>, or <b>Add shortcut to My files</b>. It then appears in File Explorer under <i>Crown Resorts</i> or <i>OneDrive - Crown Resorts</i>.</li>
          <li>Back here, click <b>Change folder</b> and choose that synced folder.</li>
        </ol></div>` : '';
    panel.innerHTML = `<div class="folder-box"><strong>📁 ${esc(folderName())}</strong>
      <p class="muted small">${folderPerm === 'granted'
        ? (scanning ? `Checking files ${scanProgress}…` : `Checked ${st && st.lastScan ? new Date(st.lastScan).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : 'not yet'}${st && st.found != null ? ` · ${st.found} files found` : ''} · rechecks every few minutes while open.`)
        : 'The browser needs your OK again before it can read this folder.'}</p>
      <div class="row">
        ${folderPerm === 'granted' ? '<button class="btn primary sm" type="button" data-folder="scan">Check now</button><button class="btn sm" type="button" data-folder="reread">Re-read all</button>' : '<button class="btn primary sm" type="button" data-folder="reconnect">Reconnect</button>'}
        <button class="btn sm" type="button" data-folder="link">Change folder</button>
        <button class="btn sm danger" type="button" data-folder="unlink">Unlink</button>
      </div>
      ${shortcutHelp}
      ${summary.map(([k, g]) => `<details ${k === 'error' ? 'open' : ''}><summary>${LABEL[k]}: ${g.length}</summary><ul>${g.slice(0, 150).map(([path, v]) =>
        `<li><b>${esc(path)}</b>${v.detail && k !== 'shortcut' ? ` · ${esc(v.detail)}` : ''}</li>`).join('')}${g.length > 150 ? `<li>…and ${g.length - 150} more</li>` : ''}</ul></details>`).join('')}
    </div>`;
  }

  function folderButton() {
    if (!folderHandle) linkFolder();
    else if (folderPerm !== 'granted') reconnectFolder();
    else scanFolder(true);
  }

  function removeSource(id, silent) {
    state.sources = state.sources.filter((s) => s.id !== id);
    state.events = state.events.filter((e) => e.source !== id);
    state.shifts = state.shifts.filter((s) => s.source !== id);
    if (!silent) { save(); render(); renderSources(); }
  }

  function renderSources() {
    renderFolder();
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
    $('btnFolder').onclick = folderButton;
    $('folderPanel').onclick = (e) => {
      const a = e.target.closest('[data-folder]'); if (!a) return;
      ({ link: linkFolder, scan: () => scanFolder(true), reread: rereadFolder, reconnect: reconnectFolder, unlink: unlinkFolder })[a.dataset.folder]();
    };
    // Look for new documents every few minutes, and whenever the dashboard comes back into view.
    setInterval(() => { if (!document.hidden) scanFolder(false); }, 3 * 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) scanFolder(false); });
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
      state.sources = []; state.events = []; state.shifts = [];
      if (state.folder) { state.folder.seen = {}; state.folder.files = {}; }   // next folder check reloads everything
      save(); render(); renderSources();
    };
    $('btnSample').onclick = loadSample;

    $('btnSettings').onclick = () => { $('myName').value = state.myName; $('settingsDlg').showModal(); };
    $('btnSaveSettings').onclick = () => { state.myName = $('myName').value.trim(); save(); render(); };

    $('dayPrev').onclick = () => selectDate(addDays(view.selected, -1));
    $('dayNext').onclick = () => selectDate(addDays(view.selected, 1));
    $('dayToday').onclick = () => selectDate(todayISO());
    $('calPrev').onclick = () => { view.month = new Date(view.month.getFullYear(), view.month.getMonth() - 1, 1); render(); };
    $('calNext').onclick = () => { view.month = new Date(view.month.getFullYear(), view.month.getMonth() + 1, 1); render(); };
    document.querySelectorAll('[data-calmode]').forEach((b) => b.onclick = () => {
      view.calMode = b.dataset.calmode;
      try { localStorage.setItem(STORE + '.calMode', view.calMode); } catch (_) {}
      if (view.calMode === 'shifts' && !state.shifts.length) toast('No shifts loaded yet. Import a TL Sheet or roster.');
      render();
    });
    $('onlyMine').onchange = (e) => {
      view.onlyMine = e.target.checked;
      try { localStorage.setItem(STORE + '.onlyMine', view.onlyMine ? '1' : '0'); } catch (_) {}
      if (view.onlyMine && !state.myName) toast('Set your name in ⚙︎ Settings so I know which events are yours.');
      render();
    };

    // Manual BEO ↔ TL links.
    document.addEventListener('change', (e) => {
      const sel = e.target.closest('.link-pick'); if (!sel) return;
      setLink(sel.dataset.linkDate, sel.dataset.linkDuty, sel.value);
      toast(sel.value === '' ? 'Back to automatic matching.' : sel.value === 'none' ? 'Kept separate.' : 'Linked. Bar staff now show on that BEO.');
    });
    document.addEventListener('click', (e) => {
      const ch = e.target.closest('[data-change-link]');
      if (ch) {
        e.stopPropagation();
        const cur = (state.links || {})[linkKey(ch.dataset.linkDate, ch.dataset.changeLink)] || '';
        const span = document.createElement('span');
        span.innerHTML = linkPicker(ch.dataset.linkDate, ch.dataset.changeLink, cur);
        ch.replaceWith(span);
        span.querySelector('select').focus();
      }
    }, true);
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

  load(); wire(); render(); initFolder();
  // Test hook: lets automated tests link a folder handle without the native picker.
  window.__crownTestLinkFolder = async (h) => { folderHandle = h; folderPerm = 'granted'; state.folder = { name: h.name, seen: {}, files: {} }; await scanFolder(true); };
})();
