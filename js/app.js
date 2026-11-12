(function () {
  'use strict';
  const P = window.CrownParse;
  const $ = (id) => document.getElementById(id);
  const STORE = 'crownDash.v1';
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  /* ---------- State ---------- */
  let state = { sources: [], events: [], shifts: [], myName: '', keepMonths: 3, consKeep: 'fy2' };
  const view = { selected: P.isoOf(new Date()), month: firstOfMonth(new Date()), weekStart: null, onlyMine: false, calMode: 'shifts', calRange: 'week' };

  function load() {
    try { const s = JSON.parse(localStorage.getItem(STORE)); if (s) state = Object.assign(state, s); } catch (_) {}
    delete state.tl;
    try { view.onlyMine = localStorage.getItem(STORE + '.onlyMine') === '1'; } catch (_) {}
    try { view.calMode = localStorage.getItem(STORE + '.calMode') || 'shifts'; } catch (_) {}
    try { view.calRange = localStorage.getItem(STORE + '.calRange') || 'week'; } catch (_) {}
    view.weekStart = mondayOf(new Date());
    if (state.keepMonths == null) state.keepMonths = 3;
    // Bar consumption: keep this and last financial year by default (replaces the earlier 12-month default).
    if (state.consKeep == null) state.consKeep = 'fy2';
    delete state.consKeepMonths;
    if (pruneOld()) save();
  }

  /* Housekeeping: drop events and shifts dated more than `keepMonths` ago from the dashboard's own
   * storage (this browser only). Files and linked folders are never touched, and a file that's already
   * been read isn't read again just because its old events were cleared. Returns how many were removed. */
  /* Bar consumption days are kept separately (IndexedDB) with their own period.
   * 'fy2' = this and last financial year (1 July – 30 June), 'fy3' = three, a number = months, 0 = forever. */
  function consCutoff(keep) {
    const now = new Date();
    const m = String(keep).match(/^fy(\d)$/);
    if (m) {
      const fyStart = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;   // July = month 6
      return `${fyStart - (+m[1] - 1)}-07-01`;
    }
    const months = +keep;
    return months ? P.isoOf(new Date(now.getFullYear(), now.getMonth() - months, now.getDate())) : '';
  }
  const consKeepLabel = (k) => ({ fy2: 'this and last financial year', fy3: 'the last three financial years', 0: 'forever' }[k] || `${k} months`);
  function pruneCons() {
    const cutoff = consCutoff(state.consKeep);
    if (!cutoff) return 0;
    const old = state.sources.filter((src) => src.cons && src.consDate && src.consDate < cutoff);
    old.forEach((src) => removeSource(src.id, true));
    return old.length;
  }

  function pruneOld() {
    const months = +state.keepMonths;
    if (!months) return 0;
    const now = new Date();
    const cutoff = P.isoOf(new Date(now.getFullYear(), now.getMonth() - months, now.getDate()));
    // Manager allocation weeks that ended before the cutoff.
    if (window.CrownMgrUI) for (const id of window.CrownMgrUI.prune(cutoff)) state.sources = state.sources.filter((x) => x.id !== id);
    const before = state.events.length + state.shifts.length;
    const had = new Set([...state.events, ...state.shifts].map((x) => x.source));
    state.events = state.events.filter((e) => !e.date || e.date >= cutoff);
    state.shifts = state.shifts.filter((x) => !x.date || x.date >= cutoff);
    const removed = before - state.events.length - state.shifts.length;
    if (!removed) return 0;
    // Update document counts; forget documents whose events have all been cleared.
    const count = {};
    for (const x of [...state.events, ...state.shifts]) count[x.source] = (count[x.source] || 0) + 1;
    state.sources = state.sources.filter((src) => !had.has(src.id) || count[src.id]);
    for (const src of state.sources) {
      if (src.cons || src.mgr) continue;   // consumption days / manager weeks are counted separately
      src.events = state.events.filter((e) => e.source === src.id).length;
      src.shifts = state.shifts.filter((x) => x.source === src.id).length;
    }
    // Manual BEO links for those days aren't needed any more either.
    for (const k of Object.keys(state.links || {})) if (k.slice(0, 10) < cutoff) delete state.links[k];
    return removed;
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (_) { toast('Could not save to this browser — data will reset on reload.'); }
  }

  /* ---------- Helpers ---------- */
  function firstOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function mondayOf(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
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
    const main = all.filter((e) => !e.fromTL).map((e) => Object.assign({}, e, { barStaff: [], barNotes: [], bars: [], tlDuties: [], missing: [], tasks: [] }));
    const beos = main.filter((b) => b.beo);
    const out = [...main];
    // The same TL event name on two tabs (or written twice) for the same day is one event.
    const tlByName = new Map();
    const useSource = tlSourceFor(iso);
    for (const e of all.filter((x) => x.fromTL && x.source === useSource)) {
      const k = `${e.kind || 'event'}|${M.key(e.title)}`;
      const g = tlByName.get(k);
      if (!g) { tlByName.set(k, Object.assign({}, e, { bars: [...(e.bars || [])], staffDetail: [...(e.staffDetail || [])], missing: [...(e.missing || [])], tasks: [...(e.tasks || [])] })); continue; }
      for (const b of e.bars || []) if (!g.bars.includes(b)) g.bars.push(b);
      for (const d of e.staffDetail || []) if (!g.staffDetail.some((x) => x.name === d.name && x.start === d.start)) g.staffDetail.push(d);
      g.missing.push(...(e.missing || []));
      for (const t of e.tasks || []) if (!g.tasks.includes(t)) g.tasks.push(t);
      if (e.start && (!g.start || e.start < g.start)) g.start = e.start;
      g.notes = [g.notes, e.notes].filter(Boolean).join(' · ');
    }
    const tl = [...tlByName.values()];
    const choice = new Map();
    for (const t of tl) {
      const manual = (state.links || {})[linkKey(iso, t.title)];
      choice.set(t, { manual, m: manual ? (manual === 'none' ? null : beos.find((b) => b.id === manual) || null)
        : t.kind === 'setup' ? null : M.best(t.title, t.bars, beos) });
    }
    // Last resort: if exactly one TL event and one BEO are left over on the day and they plausibly belong
    // together (a shared name word, or the bar is in the BEO's room), pair them.
    const usedBeos = new Set([...choice.values()].map((c) => c.m).filter(Boolean));
    const leftTL = tl.filter((t) => t.kind !== 'setup' && !choice.get(t).m && !choice.get(t).manual);
    const leftBeos = beos.filter((b) => !usedBeos.has(b));
    if (leftTL.length === 1 && leftBeos.length === 1) {
      const t = leftTL[0], b = leftBeos[0];
      if (M.score(t.title, t.bars, b) > 0 || M.barSuitsVenue(t.bars, b.venue)) choice.set(t, { m: b, guess: true });
    }
    for (const t of tl) {
      const { manual, m, guess } = choice.get(t);
      if (m) {
        m.barStaff.push(...(t.staffDetail || []).map((d) => Object.assign({ duty: t.title }, d)));
        m.bars = [...new Set([...m.bars, ...(t.bars || [])])];
        if (t.notes) m.barNotes.push(t.notes);
        m.missing.push(...(t.missing || []));
        m.tasks.push(...(t.tasks || []));
        m.manager = m.manager || t.manager;
        m.tlDuties.push({ duty: t.title, manual: !!manual, guess: !!guess, from: tlFrom(t) });
      } else {
        out.push(Object.assign({}, t, { barStaff: (t.staffDetail || []).map((d) => Object.assign({ duty: t.title }, d)), barNotes: t.notes ? [t.notes] : [], missing: t.missing || [], tasks: t.tasks || [],
          noBEO: t.kind !== 'setup', setup: t.kind === 'setup', beoChoices: beos.length, manualNone: manual === 'none',
          nearest: t.kind !== 'setup' && !manual ? M.closest(t.title, t.bars, beos) : null }));
      }
    }
    return out.sort(byTime);
  }
  /** "⚠ 3 staff needed (4:15pm CB)" for events with unfilled TL spots. */
  function missingText(e, short) {
    const n = (e.missing || []).length;
    if (!n) return '';
    if (short) return `⚠ ${n} missing`;
    const when = [...new Set(e.missing.map((m) => [m.start && fmtTime(m.start), m.bar].filter(Boolean).join(' ')).filter(Boolean))];
    return `⚠ ${n} staff still needed${when.length ? ` (${when.join(', ')})` : ''}`;
  }
  /** "TL 2.11.2026-8.11.2026 › SAT-BAR" — which file and tab a TL entry was read from. */
  function tlFrom(e) {
    const src = state.sources.find((x) => x.id === e.source);
    return `${src ? src.name : 'TL Sheet'}${e.sheet ? ' › ' + e.sheet : ''}`;
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
  /* Events that don't relate to the bar team can be hidden: one by one ("Hide"), or automatically when a
   * BEO has no bar staff on the TL sheet (Settings). Hidden events stay off the Today window, calendar
   * and day view; the day view can show them again. */
  const hideKey = (e) => (e.beo ? `beo|${e.beo.number || e.id}|${e.date}` : `tl|${e.date}|${M.key(e.title)}`);
  const autoHidden = (e) => !!state.hideNoStaff && !!e.beo && !(e.barStaff || []).length && !(e.missing || []).length;
  const isHidden = (e) => !!(state.hidden || {})[hideKey(e)] || autoHidden(e);
  function visibleEvents(iso) { return dayEvents(iso).filter((e) => !isHidden(e)); }
  function eventsOn(iso) { return visibleEvents(iso).filter((e) => !view.onlyMine || eventIsMine(e)); }
  function setHidden(key, on) {
    state.hidden = state.hidden || {};
    if (on) state.hidden[key] = new Date().toISOString().slice(0, 10); else delete state.hidden[key];
    save(); render();
  }
  /** Two TL files covering the same day (e.g. an old copy of the week): only the newest one counts for that day. */
  function tlSourceFor(iso) {
    const ids = new Set();
    for (const x of state.events) if (x.date === iso && x.fromTL) ids.add(x.source);
    for (const x of state.shifts) if (x.date === iso && x.source && x.source.startsWith('src:tl')) ids.add(x.source);
    const time = (id) => { const sx = state.sources.find((y) => y.id === id); return sx ? (sx.fileSaved || Date.parse(sx.loadedAt) || 0) : 0; };
    return [...ids].sort((a, b) => time(b) - time(a))[0];
  }
  function shiftsOn(iso) {
    const tl = tlSourceFor(iso);
    return state.shifts.filter((s) => s.date === iso && (!s.source || !s.source.startsWith('src:tl') || s.source === tl)).sort(byTime);
  }
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
    // Each part draws on its own, so a problem in one can't blank the whole page.
    const renderMgr = () => window.CrownMgrUI && window.CrownMgrUI.render();
    for (const part of [renderTodayWin, renderCalWin, renderDaily, renderCalendar, renderUpcoming, renderMgr]) {
      try { part(); } catch (e) { console.error(e); if (window.__crownShowError) window.__crownShowError(`${e.message} (${part.name})`); }
    }
  }

  function emptyState(msg, withButton) {
    return `<li class="empty">${esc(msg)}${withButton ? '<br><button class="btn primary sm" data-act="load">📂 Load documents</button>' : ''}</li>`;
  }

  function renderDaily() {
    const iso = view.selected, isToday = iso === todayISO();
    $('dailyTitle').textContent = isToday ? 'Today' : fmtShort(iso);
    $('dailyDate').textContent = fmtLong(iso);
    const noData = !state.events.length && !state.shifts.length;

    const all = dayEvents(iso).filter((e) => !view.onlyMine || eventIsMine(e));
    const hiddenHere = all.filter(isHidden);
    const evs = view.showHidden ? all : all.filter((e) => !isHidden(e));
    // Each event is a row: event details on the left, the people working it (and unfilled spots) on the right.
    // Who is on more than one event today (e.g. listed on two bar tabs at the same time).
    const onEvents = new Map();
    for (const e of evs) for (const d of e.barStaff || []) { const k = d.name.toLowerCase(); if (!onEvents.has(k)) onEvents.set(k, new Set()); onEvents.get(k).add(e.title); }
    const rows = evs.map((e) => `<li class="day-row"><div class="day-ev">${eventCard(e)}</div>${staffColumn(e, onEvents)}</li>`);
    // Shifts that don't belong to any event shown (e.g. from a plain roster) go in a last row.
    const placed = new Set(dayEvents(iso).flatMap((e) => (e.barStaff || []).map((d) => `${d.name}|${d.start}`)));
    const other = shiftsOn(iso).filter((x) => !placed.has(`${x.person}|${x.start}`) && (!view.onlyMine || isMe(x.person)));
    if (hiddenHere.length) rows.push(`<li class="hidden-note">${view.showHidden
      ? `Showing ${hiddenHere.length} hidden event${hiddenHere.length === 1 ? '' : 's'}. <button class="linkbtn" type="button" data-show-hidden="0">Hide them again</button>`
      : `${hiddenHere.length} event${hiddenHere.length === 1 ? '' : 's'} hidden. <button class="linkbtn" type="button" data-show-hidden="1">Show</button>`}</li>`);
    if (other.length) rows.push(`<li class="day-row"><div class="day-ev"><div class="event-card other-card"><div class="event-title">Other shifts</div><div class="event-meta">Rostered, but not linked to an event</div></div></div>
      <ul class="shift-list">${other.map((x) => personRow({ name: x.person, start: x.start, end: x.end, label: x.label, bar: x.venue, sub: x.duty || x.role })).join('')}</ul></li>`);
    $('dailyEvents').innerHTML = rows.length ? rows.join('')
      : emptyState(noData ? 'No documents loaded yet.' : 'No events on this day.', noData);
  }

  function personRow(p) {
    if (p.gap) return `<li class="gap-row">
      <span class="who"><span class="blank-name">Unfilled</span>${p.bar ? ` <span class="muted small">Bar · ${esc(p.bar)}</span>` : ''}${p.sub ? `<br><span class="muted small">${esc(p.sub)}</span>` : ''}</span>
      <span class="when">${p.start ? fmtTime(p.start) : ''}</span></li>`;
    return `<li class="${isMe(p.name) ? 'mine' : ''}">
      <span class="who">${esc(p.name)}${p.bar ? ` <span class="muted small">Bar · ${esc(p.bar)}</span>` : ''}${p.sub ? `<br><span class="muted small">${esc(p.sub)}</span>` : ''}${p.also && p.also.length ? `<br><span class="also">⚠ Also on: ${esc(p.also.join(', '))}</span>` : ''}</span>
      <span class="when">${p.start ? `${fmtTime(p.start)}${p.end ? '–' + fmtTime(p.end) : ''}` : esc(p.label || '')}</span></li>`;
  }

  /** The right-hand column for an event: its staff and unfilled spots, in start-time order. */
  function staffColumn(e, onEvents) {
    // Name the TL group under each person only when the event has more than one (e.g. main bar, BIR, champagne).
    const multi = (e.tlDuties || []).length > 1;
    const same = (d) => !d || !multi && !e.noBEO ? true : M.key(d) === M.key(e.title);
    const people = e.barStaff && (e.barStaff.length || e.beo || e.fromTL || (e.missing || []).length)
      ? e.barStaff.map((d) => {
        const others = onEvents ? [...(onEvents.get(d.name.toLowerCase()) || [])].filter((t) => t !== e.title) : [];
        return { name: d.name, start: d.start, bar: d.bar, sub: same(d.duty) ? '' : d.duty, also: others };
      })
      : staffFor(e).map((n) => ({ name: n }));
    const gaps = (e.missing || []).map((m) => ({ gap: true, start: m.start, bar: m.bar, sub: same(m.duty) ? '' : m.duty }));
    const all = [...people, ...gaps].sort((a, b) => (a.start || '99').localeCompare(b.start || '99') || (a.gap ? 1 : 0) - (b.gap ? 1 : 0));
    return `<ul class="shift-list">${all.length ? all.map(personRow).join('')
      : `<li class="empty">${e.beo ? 'No bar staff on the TL sheet' : 'No staff listed'}</li>`}</ul>`;
  }

  /* ---------- Compact windows (main page) ---------- */
  const staffOf = (e) => (e.barStaff && (e.barStaff.length || e.beo || e.fromTL) ? e.barStaff.map((d) => ({ name: d.name, start: d.start }))
    : staffFor(e).map((n) => ({ name: n, start: null })));

  function renderTodayWin() {
    const iso = todayISO();
    $('todayWinDate').textContent = fmtLong(iso);
    const evs = visibleEvents(iso).sort((a, b) => (a.setup ? 1 : 0) - (b.setup ? 1 : 0));   // set-up teams last
    const noData = !state.events.length && !state.shifts.length;
    $('todayWinList').innerHTML = evs.length ? evs.map((e) => {
      const st = staffOf(e).sort((a, b) => (a.start || '99').localeCompare(b.start || '99'));
      return `<li class="${e.setup ? 'win-setup' : ''}"><div class="win-ev"><span>${e.setup ? 'Set up team' : esc(e.title)}</span>${e.start && !e.setup ? `<span class="t">${fmtTime(e.start)}</span>` : ''}</div>
        ${st.length ? `<div class="win-staff">${st.map((d) => `<span class="${isMe(d.name) ? 'me' : ''}">${esc(d.name)}${d.start ? ` <b>${fmtTime(d.start)}</b>` : ''}</span>`).join('')}</div>`
          : (e.missing || []).length ? '' : '<div class="win-none">No staff listed</div>'}
        ${missingText(e) ? `<div class="win-warn">${esc(missingText(e))}</div>` : ''}</li>`;
    }).join('') : `<li class="win-empty">${noData ? 'No documents loaded yet. <button class="btn primary sm" data-act="load">📂 Load documents</button>' : 'Nothing on today.'}</li>`;
  }

  function renderCalWin() {
    const days = [todayISO(), addDays(todayISO(), 1)];
    $('calWinDays').innerHTML = days.map((iso, i) => {
      const evs = visibleEvents(iso).sort((a, b) => (a.setup ? 1 : 0) - (b.setup ? 1 : 0));
      const items = evs.length ? evs.map((e) => {
        const st = staffOf(e), from = st.map((d) => d.start).filter(Boolean).sort()[0];
        if (e.setup) return `<li class="win-setup-line"><span class="t">${e.start ? fmtTime(e.start) : ''}</span>Set up team<span class="sub">${st.length} staff</span></li>`;
        return `<li><span class="t">${e.start ? fmtTime(e.start) : ''}</span>${esc(e.title)}
          ${st.length || (e.missing || []).length ? `<span class="sub">${st.length} staff${from ? ` from ${fmtTime(from)}` : ''}${(e.missing || []).length ? ` · <span class="warn-text">${esc(missingText(e, true))}</span>` : ''}</span>` : ''}</li>`;
      }).join('') : shiftsOn(iso).map((s) => `<li><span class="t">${esc(shiftWhen(s))}</span>${esc(s.person)}${s.venue ? `<span class="sub">${esc(s.venue)}</span>` : ''}</li>`).join('');
      return `<div class="win-day"><h3>${i ? 'Tomorrow' : 'Today'} · ${fmtShort(iso)}</h3><ul>${items || '<li class="win-empty">Nothing on.</li>'}</ul></div>`;
    }).join('');
  }

  function openDay(iso) {
    if (iso) selectDate(iso); else render();
    if ($('calDlg').open) $('calDlg').close();
    if (!$('dayDlg').open) $('dayDlg').showModal();
  }
  function openCal() {
    view.weekStart = mondayOf(parseISO(view.selected));
    render();
    if (!$('calDlg').open) $('calDlg').showModal();
  }

  function eventCard(e) {
    const b = e.beo;
    const sub = [b && b.beoName, b && b.number && `BEO #${b.number}`, b && b.eventManager && `EM: ${b.eventManager}`].filter(Boolean).map(esc).join(' · ');
    const meta = [e.venue && !e.noBEO && !e.setup ? e.venue : '', e.pax && `${e.pax} guests`].filter(Boolean).map(esc).join(' · ');
    const barLine = [e.bars && e.bars.length && `Bar: ${e.bars.join(' / ')}`, e.manager && `Manager: ${e.manager}`].filter(Boolean).map(esc).join(' · ');
    const fns = b && b.functions && b.functions.length ? `<details class="more-info"><summary>Function times</summary><table>${b.functions.map((f) =>
      `<tr><td>${f.date && f.date !== e.date ? `<b>${esc(fmtShort(f.date))}</b> ` : ''}${f.start ? fmtTime(f.start) + '–' + fmtTime(f.end) : ''}</td><td>${esc(f.event)}</td><td>${esc(f.venue)}</td><td>${f.gtd ? f.gtd + ' gtd' : ''}</td></tr>`).join('')}</table></details>` : '';
    const bev = b && b.beverage && b.beverage.length ? `<details class="more-info"><summary>Beverage</summary><ul>${b.beverage.map((l) =>
      /^\d{1,2}:\d{2}\s*-/.test(l) ? `<li class="sub">${esc(l)}</li>` : `<li>${esc(l)}</li>`).join('')}</ul></details>` : '';
    const hidden = isHidden(e);
    const hideBtn = hidden
      ? ((state.hidden || {})[hideKey(e)] ? `<button class="btn ghost sm hide-btn" type="button" data-unhide="${esc(hideKey(e))}">Unhide</button>` : '<span class="muted small hide-btn">Hidden: no bar staff</span>')
      : `<button class="btn ghost sm hide-btn" type="button" data-hide="${esc(hideKey(e))}" title="Hide this event from your dashboard">Hide</button>`;
    return `<div class="event-card ${eventIsMine(e) ? 'mine' : ''} ${e.noBEO ? 'nobeo' : ''} ${hidden ? 'is-hidden' : ''}">${hideBtn}
      <div class="event-time">${e.start ? fmtTime(e.start) : 'All day'}${e.end ? `<small>to ${fmtTime(e.end)}</small>` : ''}</div>
      <div>
        <div class="event-title">${esc(e.title)}${e.setup ? (/^set up team$/i.test(e.title) ? '' : ' <span class="tag">Set up team</span>') : e.noBEO ? ` <span class="tag">${e.manualNone ? 'TL only' : 'TL only · no matching BEO'}</span>` : ''}</div>
        ${e.noBEO && e.beoChoices ? `<div class="event-meta">Is this one of today's BEOs? ${linkPicker(e.date, e.title, e.manualNone ? 'none' : '')}</div>` : ''}
        ${e.nearest && e.nearest.beo && e.nearest.sc > 0 ? `<div class="event-meta small">Closest BEO today: “${esc(e.nearest.beo.title)}” (${e.nearest.sc > 0 ? 'some words match, but not enough' : 'no name words in common'})</div>` : ''}
        ${e.fromTL ? `<div class="event-meta small">From ${esc(tlFrom(e))}</div>` : ''}
        ${e.tlDuties && e.tlDuties.length ? `<div class="event-meta tl-from">TL: ${e.tlDuties.map((d) => `<span title="From ${esc(d.from || '')}">“${esc(d.duty)}”</span>${d.manual ? ' (linked by you)' : d.guess ? ' (best guess)' : ''} <button class="linkbtn" type="button" data-change-link="${esc(d.duty)}" data-link-date="${esc(e.date)}">change</button>`).join(', ')}</div>` : ''}
        ${sub ? `<div class="event-meta">${sub}</div>` : ''}
        ${meta ? `<div class="event-meta">${meta}</div>` : ''}
        ${barLine ? `<div class="event-meta">${barLine}</div>` : ''}
        ${(e.barNotes || []).concat(e.barStaff ? [] : [e.notes]).filter(Boolean).map((n) => `<div class="event-meta note">${esc(n)}</div>`).join('')}
        ${missingText(e) ? `<div class="warn-line">${esc(missingText(e))}</div>` : ''}
        ${e.tasks && e.tasks.length ? `<div class="tasks"><span class="label">${e.setup ? 'Duties' : 'After the event'}</span><ul>${e.tasks.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
        ${fns}${bev}
      </div></div>`;
  }

  function renderCalendar() {
    const week = view.calRange === 'week';
    const m = view.month;
    let start, cells;
    if (week) {
      start = new Date(view.weekStart); cells = 7;
      const end = new Date(start); end.setDate(start.getDate() + 6);
      const f = (d, o) => d.toLocaleDateString('en-AU', o);
      $('calMonth').textContent = `${f(start, { day: 'numeric', month: 'short' })} – ${f(end, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    } else {
      $('calMonth').textContent = m.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
      start = new Date(m); start.setDate(1 - ((m.getDay() + 6) % 7)); // Monday-first
      cells = 42;
    }
    $('calGrid').classList.toggle('week', week);
    $('calWrap').classList.toggle('week', week);
    const cap = week ? 30 : 4;
    let html = DOW.map((d) => `<div class="dow">${d}</div>`).join('');
    const today = todayISO();
    for (let i = 0; i < cells; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const iso = P.isoOf(d);
      if (!week && i === 35 && d.getMonth() !== m.getMonth()) break; // drop empty 6th row
      const evs = eventsOn(iso);
      const shs = calShiftsOn(iso);
      const myShift = shiftsOn(iso).find((s) => isMe(s.person));
      const showShifts = view.calMode === 'shifts' && state.shifts.length;
      const gaps = evs.filter((e) => (e.missing || []).length).map((e) =>
        `<span class="gap" title="${esc(e.title)}: ${esc(missingText(e))}">${esc(missingText(e, true))}<br><span class="muted">${esc(e.bars && e.bars.length ? e.bars.join('/') : e.title)}</span></span>`);
      const items = showShifts
        ? gaps.concat(shs.map((s) => `<span class="sh ${isMe(s.person) ? 'mine' : ''}" title="${esc(s.person)} · ${esc(shiftWhen(s))}${s.venue ? ' · ' + esc(s.venue) : ''}"><b>${esc(shiftWhen(s))}</b> ${esc(shortName(s.person))}${s.venue ? `<br><span class="muted">${esc(s.venue)}</span>` : ''}</span>`))
        : evs.map((e) => `<span class="ev ${eventIsMine(e) ? 'mine' : ''} ${(e.missing || []).length ? 'short' : ''}" title="${esc(e.title)}${(e.missing || []).length ? ' · ' + esc(missingText(e)) : ''}">${(e.missing || []).length ? '⚠ ' : ''}${e.start ? fmtTime(e.start) + ' ' : ''}${esc(e.title)}</span>`);
      const cls = ['day', !week && d.getMonth() !== m.getMonth() && 'other', iso === today && 'today', iso === view.selected && 'selected'].filter(Boolean).join(' ');
      html += `<button type="button" class="${cls}" data-date="${iso}" aria-label="${fmtLong(iso)}, ${shs.length} shifts, ${evs.length} events">
        <span class="num">${d.getDate()}</span>${week ? `<span class="wk-dow">${DOW[i]}</span>` : ''}
        ${myShift && !showShifts ? `<span class="shiftdot">● On ${myShift.start ? fmtTime(myShift.start) : esc(myShift.label)}</span>` : ''}
        ${items.slice(0, cap).join('')}
        ${items.length > cap ? `<span class="more">+${items.length - cap} more</span>` : ''}
      </button>`;
    }
    $('calGrid').innerHTML = html;
    document.querySelectorAll('[data-calmode]').forEach((b) => b.classList.toggle('on', b.dataset.calmode === view.calMode));
    document.querySelectorAll('[data-calrange]').forEach((b) => b.classList.toggle('on', b.dataset.calrange === view.calRange));
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
    view.weekStart = mondayOf(d);
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
    if (first.isCons) {
      // One consumption workbook per day: a re-saved copy of the same day replaces it.
      // One record per report file and day, so two reports can never overwrite each other, while a
      // re-saved copy of the same report ("05 (1).xlsm", "05 - Copy.xlsm") still replaces it.
      const day = first.cons.date || 'undated';
      const base = name.replace(/\.[a-z0-9]+$/i, '').replace(/\s*(\(\d+\)|-\s*copy(\s*\(\d+\))?)\s*$/i, '').trim().toLowerCase();
      return { fileName: name, sheets, sourceId: `src:cons:${day}|${base}`, auto: true, cons: first.cons,
        displayName: `Bar consumption · ${first.cons.date ? fmtShort(first.cons.date) : name}` };
    }
    if (first.isMgr) {
      // One allocation per week: a re-saved or renamed copy of the same week replaces it.
      const wk = first.mgr.weekStart;
      return { fileName: name, sheets, sourceId: 'src:mgr:' + wk, auto: true, mgr: first.mgr,
        displayName: `Manager allocation · week of ${fmtShort(wk)}` };
    }
    if (first.isBEO && first.beoNumber) {
      // A revised BEO ("… (6).pdf") replaces the earlier version with the same BEO number.
      return { fileName: name, sheets, sourceId: 'src:beo:' + first.beoNumber, displayName: first.label, auto: true,
        beoNumber: first.beoNumber, beoCreated: first.beoCreated || '' };
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
      if (sh.isMgr) {
        const m = sh.mgr, t = (d) => (d.off || (d.start ? d.start + (d.end ? '–' + d.end : '') : d.text || (d.events.length ? '—' : '')));
        div.innerHTML = `<div class="imp-head"><strong>${esc(name)}</strong><span class="muted small">${fmtShort(m.dates[0])} – ${fmtShort(m.dates[6])}</span></div>
          <div class="preview"><table><tr><th>Manager</th><th>Role</th>${m.dates.map((d) => `<th>${esc(fmtShort(d))}</th>`).join('')}</tr>${m.people.map((p) =>
            `<tr><td>${esc(p.name || '(name not filled in)')}</td><td>${esc(p.role)}</td>${m.dates.map((d) => `<td>${esc(t(p.days[d]))}</td>`).join('')}</tr>`).join('')}</table></div>${warn(sh.ready.warnings)}`;
        return;
      }
      if (sh.isCons) {
        const c = sh.cons;
        div.innerHTML = `<div class="imp-head"><strong>${esc(name)}</strong><span class="muted small">${c.date ? fmtLong(c.date) : 'date not found'}</span></div>
          <div class="preview"><table><tr><th>Event</th><th>BEO</th><th>Pax</th><th>Bars</th><th>Units used</th><th>Bev total (MICROS)</th><th>Bev cost</th></tr>${c.events.map((e) =>
            `<tr><td>${esc(e.event)}</td><td>${esc(e.beo)}</td><td>${e.pax || ''}</td><td>${esc(e.bars.join(', '))}</td><td>${Math.round(e.units)}</td><td>${e.micros || e.revenue ? '$' + Math.round(e.micros != null ? e.micros : e.revenue * 1.1).toLocaleString('en-AU') : '—'}</td><td>${e.cost ? '$' + Math.round(e.cost).toLocaleString('en-AU') : '—'}</td></tr>`).join('')}</table></div>${warn(sh.ready.warnings)}`;
        return;
      }
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
    const older = pending.filter((p) => p.olderThan);
    if (older.length) setTimeout(() => toast(older.map((p) => `Kept the newer BEO #${p.beoNumber} (created ${fmtCreated(p.olderThan)}); “${p.fileName}” is an older copy (created ${fmtCreated(p.beoCreated)}).`).join(' ')), 50);
    const jump = dates.find((d) => d >= todayISO()) || dates[0];
    pending = [];
    save();
    if (jump) selectDate(jump); else render();
  }

  /** Stores entries (replacing earlier data from the same source). Returns their dates, sorted. */
  function commitEntries(entries, quiet) {
    let ne = 0, ns = 0;
    const dates = [], consDays = [], mgrWeeks = [];
    for (const file of entries) {
      const id = file.sourceId || 'src:' + file.fileName.toLowerCase();
      // Two copies of the same BEO: keep the one printed most recently (its "Created" time), whatever
      // order the files arrive in or what they're called.
      const prev = state.sources.find((x) => x.id === id);
      if (file.beoCreated && prev && prev.beoCreated && file.beoCreated < prev.beoCreated) { file.olderThan = prev.beoCreated; continue; }
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
      const src = { id, name: file.displayName || file.fileName, loadedAt: new Date().toISOString(), events: events.length, shifts: shifts.length, fromFolder: !!file.fromFolder, fileSaved: file.fileSaved || null, path: file.path || null, beoCreated: file.beoCreated || null };
      if (file.cons) {
        // Older versions stored one record per date ("src:cons:2026-07-05"); replace it.
        if (file.cons.date && state.sources.some((x) => x.id === 'src:cons:' + file.cons.date)) removeSource('src:cons:' + file.cons.date, true);
        // Consumption data lives in IndexedDB; the source entry just records it.
        Object.assign(src, { cons: true, consDate: file.cons.date, events: file.cons.events.length, units: Math.round(file.cons.rows.reduce((a, x) => a + x.used, 0)) });
        window.CrownConsUI.add(id, file.cons);
        consDays.push(file.cons.date ? fmtShort(file.cons.date) : file.fileName);
      }
      if (file.mgr) {
        Object.assign(src, { mgr: true, mgrWeekEnd: file.mgr.dates[6], people: file.mgr.people.length });
        window.CrownMgrUI.add(id, Object.assign({}, file.mgr, { file: file.fileName, savedAt: file.fileSaved || Date.now() }));
        mgrWeeks.push(fmtShort(file.mgr.weekStart));
      }
      state.sources.push(src);
      ne += events.length; ns += shifts.length;
      events.concat(shifts).forEach((x) => x.date && dates.push(x.date));
    }
    pruneCons();
    const cleared = pruneOld();
    if (!quiet && mgrWeeks.length && !consDays.length && !ne && !ns) toast(`Imported the manager allocation for the week of ${mgrWeeks.join(', ')}.`);
    else if (!quiet && consDays.length && !ne && !ns) toast(`Imported bar consumption for ${consDays.join(', ')}.${mgrWeeks.length ? ` Manager allocation: week of ${mgrWeeks.join(', ')}.` : ''}`);
    else if (!quiet) toast(`Imported ${ne} events and ${ns} shifts.${consDays.length ? ` Bar consumption: ${consDays.join(', ')}.` : ''}${cleared ? ` ${cleared} older than ${state.keepMonths} month${+state.keepMonths === 1 ? '' : 's'} not kept.` : ''}`);
    return dates.sort();
  }

  /* ---------- Linked folders ---------- */
  // Several folders can be linked (e.g. the synced SharePoint TL folder and a BEO folder). Each is
  // checked when the dashboard opens and on the hour while it's open; only new or changed files are read.
  const F = window.CrownFolder;
  let nextCheckAt = null;
  const FIRST_SCAN_DAYS = 60;   // on first link, ignore PDFs untouched for longer than this
  // READER_VERSION: bumping it re-reads every file (kept at 15; prefer READERS below).
  const READER_VERSION = 15;
  // One version per kind of file. Bump just the kind whose reader changed, so only those files are
  // read again ("other" = files that weren't recognised, re-checked when a new kind is added).
  const READERS = { tl: 1, beo: 1, cons: 1, mgr: 1, other: 1 };
  const kindOf = (entry) => (entry.mgr ? 'mgr' : entry.cons ? 'cons' : entry.sheets[0].isTL ? 'tl' : entry.sheets[0].isBEO || entry.beoNumber ? 'beo' : 'other');
  // Files read before kinds were recorded: worked out from what Documents says about them.
  const kindFromInfo = (v) => { const d = (v && v.detail) || '';
    return /^manager allocation/.test(d) ? 'mgr' : /^bar consumption/.test(d) ? 'cons' : /bar shifts$/.test(d) ? 'tl'
      : (v && v.status === 'older') || /BEO|\bevents?\b/.test(d) ? 'beo' : 'other'; };
  const pause = () => new Promise((r) => setTimeout(r, 0));
  let folders = [];             // [{ id, handle, perm }]
  let scanningId = null, scanProgress = '';
  const fname = (f) => (f && f.handle && f.handle.name) || 'linked folder';
  const fstate = (id) => { state.folders = state.folders || {}; return state.folders[id] || (state.folders[id] = { seen: {}, files: {} }); };
  const needsOk = () => folders.filter((f) => f.perm !== 'granted');

  async function initFolder() {
    if (!F || !F.supported) return;
    $('btnFolder').hidden = false;
    const items = await F.savedAll();
    // Older versions kept one folder's progress in state.folder.
    if (state.folder && items[0]) { state.folders = state.folders || {}; if (!state.folders[items[0].id]) state.folders[items[0].id] = state.folder; }
    delete state.folder;
    folders = [];
    for (const it of items) {
      let perm = 'prompt';
      try { perm = await F.permission(it.handle, false); } catch (_) {}
      folders.push({ id: it.id, handle: it.handle, perm });
    }
    save(); renderFolder();
    scanAll(false);
  }

  async function linkFolder(replaceId) {
    if (!F || !F.supported) { toast('Linking a folder needs Microsoft Edge or Google Chrome.'); return; }
    let handle;
    try { handle = await F.choose(); } catch (e) { if (e.name !== 'AbortError') toast('Couldn\'t link that folder: ' + e.message); return; }
    const { id, existed } = await F.add(handle, replaceId);
    if (existed) { toast(`📁 ${handle.name} is already linked.`); return; }
    folders = folders.filter((f) => f.id !== id).concat({ id, handle, perm: 'granted' });
    state.folders = state.folders || {};
    state.folders[id] = { name: handle.name, seen: {}, files: {}, readerVersion: READER_VERSION };
    save(); renderFolder();
    await scanAll(true, id);
  }

  async function reconnectFolders() {
    for (const f of needsOk()) {
      try { f.perm = await F.permission(f.handle, true); } catch (_) { f.perm = 'denied'; }
    }
    renderFolder();
    if (needsOk().length) toast('The browser didn\'t allow access to every folder.');
    scanAll(true);
  }

  async function unlinkFolder(id) {
    await F.remove(id);
    folders = folders.filter((f) => f.id !== id);
    if (state.folders) delete state.folders[id];
    save(); renderFolder(); renderSources();
  }

  async function rereadFolder(id) {
    fstate(id).seen = {}; fstate(id).kind = {};
    await scanAll(true, id);
  }

  /** Checks every linked folder (or just `onlyId`), then shows one combined message. */
  async function scanAll(verbose, onlyId) {
    if (scanningId) return;
    const sum = { updated: [], added: [], older: [], shortcuts: 0, found: 0, failed: [] };
    for (const f of folders) {
      if (f.perm !== 'granted' || (onlyId && f.id !== onlyId)) continue;
      await scanFolder(f, sum);
    }
    const list = (a) => (a.length > 2 ? `${a.slice(0, 2).join(', ')} +${a.length - 2} more` : a.join(', '));
    const parts = [sum.updated.length && `Updated: ${list(sum.updated)}`, sum.added.length && `New: ${list(sum.added)}`,
      sum.older.length && `${sum.older.length} older BEO cop${sum.older.length === 1 ? 'y' : 'ies'} ignored`].filter(Boolean);
    if (sum.failed.length) toast(`📁 ${sum.failed.join(' · ')}`);
    else if (sum.updated.length || sum.added.length) toast(`📁 ${parts.join(' · ')}`);
    else if (sum.shortcuts && verbose) toast(`📁 A linked folder holds ${sum.shortcuts} shortcut${sum.shortcuts === 1 ? '' : 's'} (.url), not the files. Open Documents to see how to fix it.`);
    else if (verbose) toast(needsOk().length ? '📁 Some folders need reconnecting — click 📁 in the header.' : `📁 Checked. No files have changed since the last check.${sum.older.length ? ' (' + parts.join(' · ') + ')' : ''}`);
  }

  /** Imports TL Sheets / BEOs in one folder that are new or changed since its last check. */
  async function scanFolder(f, sum) {
    scanningId = f.id; scanProgress = ''; renderFolder();
    const st = fstate(f.id);
    if (st.readerVersion !== READER_VERSION) { st.seen = {}; st.kind = {}; st.readerVersion = READER_VERSION; }
    st.files = st.files || {};
    st.kind = st.kind || {};
    for (const p of Object.keys(st.seen)) if (!st.kind[p]) st.kind[p] = kindFromInfo(st.files[p]);
    // A reader improved since the last check: read just that kind of file again.
    const was = st.readers || READERS;
    for (const p of Object.keys(st.seen)) if (was[st.kind[p]] !== READERS[st.kind[p]]) delete st.seen[p];
    st.readers = Object.assign({}, READERS);
    try {
      // Only look at what can hold data we're keeping: from the start of the oldest period kept
      // (with the default setting, 1 July of last financial year).
      const keepFrom = consCutoff(state.consKeep);
      const keepFromMs = keepFrom ? parseISO(keepFrom).getTime() : 0;
      const files = await F.list(f.handle, '', 0, [], { before: keepFrom });
      st.skippedDirs = files.skippedDirs || [];
      const present = new Set(files.map((x) => x.path));
      for (const k of Object.keys(st.files)) if (!present.has(k)) delete st.files[k];
      for (const k of Object.keys(st.seen)) if (!present.has(k)) { delete st.seen[k]; delete st.kind[k]; }
      const cutoff = Date.now() - FIRST_SCAN_DAYS * 864e5;
      const todo = [];
      for (const x of files) {
        if (x.target !== undefined) { st.files[x.path] = { status: 'shortcut', detail: x.target, site: F.sharePointSite(x.target) }; continue; }
        if (x.error) { st.files[x.path] = { status: 'error', detail: `couldn't open (${x.error}). If it shows a cloud icon in File Explorer, right-click → Always keep on this device.` }; continue; }
        if (st.seen[x.path] === x.lastModified) continue;
        // Last saved before the kept period starts, so it can't hold this or last financial year's data.
        // (If someone edits it later, its saved time changes and it's looked at again.)
        if (keepFromMs && x.lastModified < keepFromMs) {
          st.files[x.path] = { status: 'old', saved: x.lastModified, detail: `last saved before ${fmtShort(keepFrom)}, outside the period kept` };
          continue;
        }
        // Spreadsheets (TL Sheets) are always read. PDFs untouched for 60+ days are left out to keep things quick.
        if (/\.(pdf|ics)$/i.test(x.name) && st.seen[x.path] == null && x.lastModified < cutoff) {
          st.files[x.path] = { status: 'old', detail: `not changed in ${FIRST_SCAN_DAYS}+ days` };
          continue;
        }
        todo.push(x);
      }
      todo.sort((a, b) => a.lastModified - b.lastModified);
      let batch = [];
      const flush = () => {
        if (!batch.length) return;
        commitEntries(batch, true);
        for (const e of batch) {
          const nice = e.fileName.replace(/\.[a-z0-9]+$/i, '');
          if (e.olderThan) {
            st.files[e.path] = { status: 'older', saved: e.fileSaved, detail: `older copy of BEO #${e.beoNumber} (created ${fmtCreated(e.beoCreated)}); the newer one (created ${fmtCreated(e.olderThan)}) is kept` };
            sum.older.push(nice);
          } else {
            (e.wasSeen ? sum.updated : sum.added).push(nice);
          }
        }
        batch = []; save(); render();
      };
      for (let n = 0; n < todo.length; n++) {
        const x = todo[n];
        scanProgress = `${n + 1}/${todo.length}`; renderFolder();
        await pause();
        try {
          const entry = await prepare(x.name, await x.file.arrayBuffer());
          if (entry.auto) {
            Object.assign(entry, { fromFolder: true, fileSaved: x.lastModified, path: x.path, wasSeen: st.seen[x.path] != null });
            const r = entry.sheets[0].ready || { events: [], shifts: [] };
            st.files[x.path] = { status: 'loaded', saved: x.lastModified,
              detail: entry.mgr ? `manager allocation · week of ${fmtShort(entry.mgr.weekStart)} · ${entry.mgr.people.length} managers` : entry.cons ? `bar consumption · ${entry.cons.events.length} events · ${Math.round(entry.cons.rows.reduce((a, x) => a + x.used, 0))} units${(entry.cons.warnings || []).length ? ' · ⚠ ' + entry.cons.warnings.join(' ') : ''}` : entry.sheets[0].isTL ? `${r.shifts.length} bar shifts` : `${r.events.length} event${r.events.length === 1 ? '' : 's'}${entry.beoCreated ? ` · BEO created ${fmtCreated(entry.beoCreated)}` : ''}` };
            batch.push(entry);
          } else {
            st.files[x.path] = { status: 'skipped', detail: 'not a TL Sheet, BEO, consumption or manager allocation workbook' };
          }
          st.seen[x.path] = x.lastModified;
          st.kind[x.path] = entry.auto ? kindOf(entry) : 'other';
        } catch (e) {
          if (/doesn't look like a BEO|looks like a TL Sheet but has no bar tabs|shortcut/i.test(e.message)) {
            // Readable, just not one of ours (contracts, banquet checks…): note it and don't re-read it at every check.
            st.files[x.path] = { status: 'skipped', detail: e.message.replace(/^This PDF doesn't look like a BEO.*$/, 'PDF that isn\'t a BEO') };
            st.seen[x.path] = x.lastModified;
            st.kind[x.path] = 'other';
          } else {
            // Not marked as seen, so it's tried again next time (e.g. a file still syncing).
            st.files[x.path] = { status: 'error', detail: e.message };
          }
        }
        if (batch.length >= 8) flush();
      }
      flush();
      st.lastScan = new Date().toISOString();
      st.found = files.length;
      st.name = fname(f);
      sum.found += files.length;
      sum.shortcuts += Object.values(st.files).filter((v) => v.status === 'shortcut').length;
    } catch (e) {
      if (e.name === 'NotAllowedError' || e.name === 'SecurityError') f.perm = 'prompt';
      else if (e.name === 'NotFoundError') sum.failed.push(`${fname(f)} can't be found. Was it moved or renamed? Use Change folder.`);
      else sum.failed.push(`${fname(f)}: ${e.message}`);
    } finally {
      scanningId = null; scanProgress = ''; save(); renderFolder();
    }
  }

  const fmtCreated = (iso) => (iso ? new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '?');

  function renderFolder() {
    const btn = $('btnFolder');
    if (!btn || btn.hidden) return;
    const busy = folders.find((f) => f.id === scanningId);
    btn.classList.toggle('warn', needsOk().length > 0);
    if (!folders.length) { btn.textContent = '📁 Link folder'; btn.title = 'Link a folder (e.g. your synced SharePoint TL folder, or a BEO folder) and new files load automatically'; }
    else if (needsOk().length) { btn.textContent = `📁 Reconnect ${needsOk().length === 1 ? fname(needsOk()[0]) : needsOk().length + ' folders'}`; btn.title = 'The browser needs your OK again to read these folders'; }
    else if (busy) btn.textContent = `📁 Checking ${fname(busy)}${scanProgress ? ' ' + scanProgress : '…'}`;
    else {
      btn.textContent = folders.length === 1 ? `📁 ${fname(folders[0])}` : `📁 ${folders.length} folders`;
      btn.title = `Linked: ${folders.map(fname).join(', ')}. Click to check for new documents now.`;
    }
    const panel = $('folderPanel');
    if (!panel) return;
    if (!F || !F.supported) { panel.innerHTML = '<p class="muted small">Linking a folder needs Microsoft Edge or Google Chrome.</p>'; return; }
    const LABEL = { loaded: 'Loaded', older: 'Older BEO copies (ignored)', error: 'Couldn\'t read', skipped: 'Not a TL Sheet, BEO, consumption or manager allocation workbook', old: 'Older files not checked', shortcut: 'Shortcuts (.url): can\'t be read' };
    const boxes = folders.map((f) => {
      const st = fstate(f.id);
      const files = Object.entries(st.files || {}).sort((a, b) => a[0].localeCompare(b[0]));
      const group = (k) => files.filter(([, v]) => v.status === k);
      const summary = ['loaded', 'older', 'error', 'shortcut', 'skipped', 'old'].map((k) => [k, group(k)]).filter(([, g]) => g.length);
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
      const ok = f.perm === 'granted';
      return `<div class="folder-box"><strong>📁 ${esc(fname(f))}</strong>
        <p class="muted small">${ok
          ? (scanningId === f.id ? `Checking files ${scanProgress}…` : `Checked ${st.lastScan ? new Date(st.lastScan).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : 'not yet'}${st.found != null ? ` · ${st.found} files found` : ''}`)
          : 'The browser needs your OK again before it can read this folder.'}</p>
        <div class="row">
          ${ok ? `<button class="btn sm" type="button" data-folder="reread" data-id="${f.id}">Re-read all</button>` : `<button class="btn primary sm" type="button" data-folder="reconnect">Reconnect</button>`}
          <button class="btn sm" type="button" data-folder="change" data-id="${f.id}">Change folder</button>
          <button class="btn sm danger" type="button" data-folder="unlink" data-id="${f.id}">Unlink</button>
        </div>
        ${shortcutHelp}
        <p class="folder-sum">${[
          group('loaded').length && `${group('loaded').length} loaded`,
          group('error').length && `<span class="warn-text">${group('error').length} couldn't be read</span>`,
          group('older').length && `${group('older').length} older BEO copies ignored`,
          group('skipped').length && `${group('skipped').length} other files`,
          (group('old').length + (st.skippedDirs || []).length) && `older files and folders skipped`,
        ].filter(Boolean).join(' · ') || 'No files read yet'}</p>
        ${summary.length || (st.skippedDirs || []).length ? `<details class="file-details"><summary>File details</summary>
          ${summary.map(([k, g]) => `<details><summary>${LABEL[k]}: ${g.length}</summary><ul>${g.slice(0, 150).map(([path, v]) =>
            `<li><b>${esc(path)}</b>${v.detail && k !== 'shortcut' ? ` · ${esc(v.detail)}` : ''}${v.saved ? ` · saved ${esc(fmtSaved(v.saved))}` : ''}</li>`).join('')}${g.length > 150 ? `<li>…and ${g.length - 150} more</li>` : ''}</ul></details>`).join('')}
          ${(st.skippedDirs || []).length ? `<details><summary>Older folders skipped: ${st.skippedDirs.length}</summary><ul>${st.skippedDirs.map((d) => `<li><b>${esc(d)}</b></li>`).join('')}</ul></details>` : ''}
        </details>` : ''}
      </div>`;
    });
    panel.innerHTML = `${boxes.join('')}
      <div class="folder-box ${folders.length ? 'add-box' : ''}">
        ${folders.length ? '' : `<strong>No folder linked</strong>
        <p class="muted small">Link the folders where TL Sheets and BEOs are saved, e.g. the SharePoint TL folder synced to File Explorer, and a folder you save BEOs into. New or updated files load automatically.</p>`}
        <div class="row">
          <button class="btn primary sm" type="button" data-folder="link">📁 ${folders.length ? 'Link another folder' : 'Link folder'}</button>
          ${folders.length ? '<button class="btn sm" type="button" data-folder="scan">Check all now</button>' : ''}
        </div>
        ${folders.length ? `<p class="muted small">All linked folders are checked when the dashboard opens and on the hour, every hour, while it's open${nextCheckAt ? ` (next check ${nextCheckAt.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })})` : ''}. Use <b>Check all now</b> to check straight away.</p>` : ''}
      </div>`;
  }

  function folderButton() {
    if (!folders.length) linkFolder();
    else if (needsOk().length) reconnectFolders();
    else scanAll(true);
  }

  function removeSource(id, silent) {
    if (id.startsWith('src:cons:') && window.CrownConsUI) window.CrownConsUI.remove(id);
    if (id.startsWith('src:mgr:') && window.CrownMgrUI) window.CrownMgrUI.remove(id);
    state.sources = state.sources.filter((s) => s.id !== id);
    state.events = state.events.filter((e) => e.source !== id);
    state.shifts = state.shifts.filter((s) => s.source !== id);
    if (!silent) { save(); render(); renderSources(); }
  }

  const fmtSaved = (ms) => new Date(ms).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  function renderSources() {
    renderFolder();
    $('sourceCountAll').textContent = state.sources.length;
    $('sourceList').innerHTML = state.sources.length ? state.sources.map((s) => `<li>
      <div><div>${esc(s.name)}</div><div class="meta">${s.mgr ? `${s.people} managers` : s.cons ? `${s.events} events · ${(s.units || 0).toLocaleString('en-AU')} units used` : `${s.events} events · ${s.shifts} shifts`}${s.beoCreated ? ` · BEO created ${esc(fmtCreated(s.beoCreated))}` : ''}${s.fileSaved ? ` · file saved ${esc(fmtSaved(s.fileSaved))}` : ''} · read ${new Date(s.loadedAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}${s.fromFolder ? ' · from linked folder' : ''}</div></div>
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
      const id = a.dataset.id;
      ({ link: () => linkFolder(), change: () => linkFolder(id), scan: () => scanAll(true), reread: () => rereadFolder(id),
        reconnect: reconnectFolders, unlink: () => unlinkFolder(id) })[a.dataset.folder]();
    };
    // Linked folders are checked when the dashboard opens (initFolder) and then on the hour, every hour,
    // while it's open (3:00, 4:00…). "Check all now" in Documents checks straight away.
    const nextHour = () => { const d = new Date(); d.setHours(d.getHours() + 1, 0, 0, 0); return d; };
    const scheduleHourly = () => {
      nextCheckAt = nextHour();
      setTimeout(() => { scanAll(false); scheduleHourly(); renderFolder(); }, Math.max(1000, nextCheckAt - Date.now()));
    };
    scheduleHourly();
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
      if (window.CrownConsUI) window.CrownConsUI.clear();
      if (window.CrownMgrUI) window.CrownMgrUI.clear();
      for (const st of Object.values(state.folders || {})) { st.seen = {}; st.files = {}; }   // next folder check reloads everything
      save(); render(); renderSources();
    };
    $('btnSample').onclick = loadSample;

    $('btnSettings').onclick = () => { $('myName').value = state.myName; $('keepMonths').value = String(state.keepMonths); $('hideNoStaff').checked = !!state.hideNoStaff; $('consKeep').value = String(state.consKeep); $('consKeepNote').textContent = consCutoff(state.consKeep) ? `Currently keeping from ${fmtLong(consCutoff(state.consKeep))}.` : 'Kept forever.'; $('settingsDlg').showModal(); };
    $('btnSaveSettings').onclick = () => {
      state.myName = $('myName').value.trim();
      state.keepMonths = +$('keepMonths').value;
      state.hideNoStaff = $('hideNoStaff').checked;
      const ck = $('consKeep').value; state.consKeep = /^fy/.test(ck) ? ck : +ck;
      const clearedDays = pruneCons();
      if (clearedDays) toast(`Cleared ${clearedDays} day${clearedDays === 1 ? '' : 's'} of bar consumption from before ${fmtLong(consCutoff(state.consKeep))} (keeping ${consKeepLabel(state.consKeep)}). Your files weren't touched.`);
      const cleared = pruneOld();
      save(); render();
      if (cleared) toast(`Cleared ${cleared} events and shifts older than ${state.keepMonths} month${state.keepMonths === 1 ? '' : 's'}. Your files weren't touched.`);
    };

    $('dayPrev').onclick = () => selectDate(addDays(view.selected, -1));
    $('dayNext').onclick = () => selectDate(addDays(view.selected, 1));
    $('dayToday').onclick = () => selectDate(todayISO());
    const step = (n) => {
      if (view.calRange === 'week') { const w = new Date(view.weekStart); w.setDate(w.getDate() + 7 * n); view.weekStart = w; }
      else view.month = new Date(view.month.getFullYear(), view.month.getMonth() + n, 1);
      render();
    };
    $('calPrev').onclick = () => step(-1);
    $('calNext').onclick = () => step(1);
    $('calThis').onclick = () => { view.weekStart = mondayOf(new Date()); view.month = firstOfMonth(new Date()); render(); };
    document.querySelectorAll('[data-calrange]').forEach((b) => b.onclick = () => {
      view.calRange = b.dataset.calrange;
      try { localStorage.setItem(STORE + '.calRange', view.calRange); } catch (_) {}
      if (view.calRange === 'month') view.month = firstOfMonth(view.weekStart);
      render();
    });
    // Compact windows open their detail panels.
    const opener = (id, fn) => {
      $(id).addEventListener('click', (e) => { if (!e.target.closest('button, a, select')) fn(); });
      $(id).addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === $(id)) { e.preventDefault(); fn(); } });
    };
    opener('todayWin', () => openDay(todayISO()));
    opener('calWin', openCal);
    document.querySelectorAll('[data-close]').forEach((b) => b.onclick = () => b.closest('dialog').close());
    // Clicking outside a popup (on the dimmed dashboard) closes it, like ✕. Only when the press both
    // starts and ends outside, so selecting text inside and letting go outside doesn't close it.
    // Not for Import (you'd lose your choices) or Settings (unsaved changes).
    for (const id of ['dayDlg', 'calDlg', 'consDlg', 'mgrDlg', 'sourcesDlg']) {
      const dlg = $(id); if (!dlg) continue;
      let downOutside = false;
      const outside = (e) => { if (e.target !== dlg) return false; const r = dlg.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom; };
      dlg.addEventListener('pointerdown', (e) => { downOutside = outside(e); });
      dlg.addEventListener('click', (e) => { if (downOutside && outside(e)) dlg.close(); downOutside = false; });
    }
    // Clicking outside a panel closes it.
    ['dayDlg', 'calDlg'].forEach((id) => $(id).addEventListener('click', (e) => { if (e.target === $(id)) $(id).close(); }));
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
      const hb = e.target.closest('[data-hide], [data-unhide], [data-show-hidden]');
      if (hb) {
        if (hb.dataset.hide) { setHidden(hb.dataset.hide, true); toast('Event hidden. Use "Show" at the bottom of the day to bring it back.'); }
        else if (hb.dataset.unhide) setHidden(hb.dataset.unhide, false);
        else { view.showHidden = hb.dataset.showHidden === '1'; render(); }
        return;
      }
      const d = e.target.closest('[data-date]');
      if (d) { if (d.closest('#calDlg')) openDay(d.dataset.date); else selectDate(d.dataset.date); }
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
    setInterval(() => { const t = todayISO(); if (t !== lastDay) { if (view.selected === lastDay) view.selected = t; lastDay = t; if (pruneOld() + pruneCons()) save(); render(); } }, 60000);
  }

  // Managers add-on: who is on today + the week's allocation. Weeks without a document entry are tidied away.
  if (window.CrownMgrUI) {
    window.CrownMgrUI.wire({ toast, myName: () => state.myName || '' });
    window.__mgrTidy = () => { const known = new Set(state.sources.map((x) => x.id)); for (const id of window.CrownMgrUI.ids()) if (!known.has(id)) window.CrownMgrUI.remove(id); };
  }
  load(); if (window.__mgrTidy) window.__mgrTidy(); wire(); render(); initFolder();
  // Ask the browser to keep this site's saved data even when the disk is low (financial-year records).
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (_) {}
  // Bar consumption add-on: totals window + panel. Days without a matching document entry are tidied away.
  if (window.CrownConsUI) {
    window.CrownConsUI.wire({ toast });
    window.CrownConsUI.load().then(() => {
      const known = new Set(state.sources.map((x) => x.id));
      for (const id of Object.keys(window.CrownConsUI.days())) if (!known.has(id)) window.CrownConsUI.remove(id);
      if (pruneCons()) save();
    });
  }
  // Test hook: lets automated tests link a folder handle without the native picker.
  window.__crownTestLinkFolder = async (h) => {
    const id = 't' + folders.length; folders.push({ id, handle: h, perm: 'granted' });
    state.folders = state.folders || {}; state.folders[id] = { seen: {}, files: {}, readerVersion: READER_VERSION };
    await scanAll(true, id);
  };
})();
