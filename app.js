/* Aforo Vehicular · app web (PWA). Datos guardados en el propio dispositivo (IndexedDB). */
(() => {
  'use strict';
  const C = window.Core;
  const { APPROACHES, MOVES, VEHICLES } = C;
  const VERSION = '1.0.0';
  const $app = document.getElementById('app');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  const S = {
    view: 'list', sessions: [], s: null, events: [], notes: [], idx: new Map(),
    tab: 'count', approach: 'NORTE', filter: null, lastInterval: 0, ticker: null, wake: null, audio: null
  };
  // Gancho solo para pruebas automáticas
  window.AforoApp = { S, onDeliver: null };

  // ---------- IndexedDB ----------
  let db;
  function openDb() {
    return new Promise((res, rej) => {
      const rq = indexedDB.open('aforo-vehicular', 1);
      rq.onupgradeneeded = () => {
        const d = rq.result;
        d.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
        d.createObjectStore('events', { keyPath: 'id', autoIncrement: true }).createIndex('sid', 'sid');
        d.createObjectStore('notes', { keyPath: 'id', autoIncrement: true }).createIndex('sid', 'sid');
      };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  }
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const store = (n, mode) => db.transaction(n, mode || 'readonly').objectStore(n);
  const dbAdd = (n, o) => req(store(n, 'readwrite').add(o));
  const dbPut = (n, o) => req(store(n, 'readwrite').put(o));
  const dbDel = (n, k) => req(store(n, 'readwrite').delete(k));
  const dbAll = n => req(store(n).getAll());
  const dbBySid = (n, sid) => req(store(n).index('sid').getAll(sid));
  const dbCountBySid = (n, sid) => req(store(n).index('sid').count(sid));
  function dbAddMany(n, arr) {
    return new Promise((res, rej) => {
      const tx = db.transaction(n, 'readwrite'), st = tx.objectStore(n);
      arr.forEach(o => st.add(o));
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  }
  async function dbDeleteSession(sid) {
    const evK = await req(store('events').index('sid').getAllKeys(sid));
    const ntK = await req(store('notes').index('sid').getAllKeys(sid));
    return new Promise((res, rej) => {
      const tx = db.transaction(['sessions', 'events', 'notes'], 'readwrite');
      tx.objectStore('sessions').delete(sid);
      evK.forEach(k => tx.objectStore('events').delete(k));
      ntK.forEach(k => tx.objectStore('notes').delete(k));
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  }

  // ---------- Tiempo ----------
  const isRunning = () => !!S.s && S.s.runStart > 0;
  const isFinished = () => !!S.s && S.s.status === 'FINALIZADA';
  const elapsedOf = (s, t) => s.accMs + (s.runStart > 0 ? t - s.runStart : 0);
  const intervalAt = t => Math.floor(elapsedOf(S.s, t) / (S.s.intervalMin * 60000));
  function clock(ms) {
    const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0 ? h + ':' + C.pad(m) + ':' + C.pad(sec) : C.pad(m) + ':' + C.pad(sec);
  }
  function timerState(t) {
    const ms = S.s.intervalMin * 60000, el = elapsedOf(S.s, t);
    return { cur: Math.floor(el / ms), rem: ms - (el % ms), el, pct: (el % ms) / ms * 100 };
  }

  // ---------- Índice de conteos ----------
  const key = (i, a, m, v) => i + '|' + a + '|' + m + '|' + v;
  function rebuildIdx() {
    S.idx = new Map();
    S.events.forEach(e => idxAdd(e, 1));
  }
  function idxAdd(e, d) {
    const k = key(e.interval, e.approach, e.movement, e.vehicle);
    S.idx.set(k, (S.idx.get(k) || 0) + d);
  }
  const cnt = (i, a, m, v) => S.idx.get(key(i, a, m, v)) || 0;

  // ---------- Avisos ----------
  let toastTimer;
  function toast(msg, ms) {
    const el = document.getElementById('toast');
    el.textContent = msg; el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('on'), ms || 3500);
  }
  function initAudio() {
    try {
      if (!S.audio) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) S.audio = new AC(); }
      else if (S.audio.state === 'suspended') S.audio.resume();
    } catch (e) { /* sin audio */ }
  }
  function beep() {
    try {
      const ctx = S.audio; if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      const t = ctx.currentTime;
      [0, 0.35].forEach(off => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, t + off);
        g.gain.exponentialRampToValueAtTime(0.4, t + off + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.3);
        o.connect(g); g.connect(ctx.destination);
        o.start(t + off); o.stop(t + off + 0.32);
      });
    } catch (e) { /* sin audio */ }
  }
  function intervalAlert(n, count) {
    beep();
    if (navigator.vibrate) navigator.vibrate([300, 120, 300]);
    document.body.classList.add('flash');
    setTimeout(() => document.body.classList.remove('flash'), 900);
    toast('✔ Intervalo ' + n + ' guardado (' + count + ' vehículos)', 6000);
  }
  async function acquireWake() {
    try {
      if ('wakeLock' in navigator && !S.wake) {
        S.wake = await navigator.wakeLock.request('screen');
        S.wake.addEventListener('release', () => { S.wake = null; });
      }
    } catch (e) { /* no disponible */ }
  }
  function releaseWake() { try { if (S.wake) S.wake.release(); } catch (e) { /* nada */ } S.wake = null; }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.view === 'session' && isRunning()) acquireWake();
  });

  // ---------- Diálogos ----------
  function modal(o) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = '<div class="modal" role="dialog" aria-modal="true"><h2>' + esc(o.title) + '</h2><div>' + (o.body || '') + '</div><div class="mactions"></div></div>';
    const acts = wrap.querySelector('.mactions');
    const close = () => wrap.remove();
    o.actions.forEach(a => {
      const b = document.createElement('button');
      b.className = 'btn ' + (a.kind || '');
      b.textContent = a.label;
      b.onclick = async () => {
        try { const keep = a.fn ? await a.fn(wrap) : false; if (keep !== true) close(); }
        catch (err) { toast('Error: ' + err.message); }
      };
      acts.appendChild(b);
    });
    wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
    document.body.appendChild(wrap);
    const first = wrap.querySelector('input,textarea,select');
    if (first) first.focus();
    return wrap;
  }
  const confirmBox = (title, msg, ok) => new Promise(res => modal({
    title, body: '<p>' + esc(msg).replace(/\n/g, '<br>') + '</p>',
    actions: [{ label: 'Cancelar', fn: () => res(false) }, { label: ok, kind: 'primary', fn: () => res(true) }]
  }));

  // ---------- Entrega de archivos ----------
  async function deliver(files) {
    if (window.AforoApp.onDeliver) window.AforoApp.onDeliver(files);
    const objs = files.map(f => new File([f.data], f.name, { type: f.mime }));
    if (navigator.canShare && navigator.canShare({ files: objs })) {
      try { await navigator.share({ files: objs, title: 'Aforo vehicular' }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    for (const f of objs) {
      const url = URL.createObjectURL(f);
      const a = document.createElement('a');
      a.href = url; a.download = f.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
      await new Promise(r => setTimeout(r, 350));
    }
    toast('Archivos descargados');
  }

  // ---------- Datos de la lista ----------
  async function loadSessions() {
    const all = await dbAll('sessions');
    for (const s of all) s.total = await dbCountBySid('events', s.id);
    all.sort((a, b) => b.createdAt - a.createdAt);
    S.sessions = all;
  }

  // ---------- Conteo abierto ----------
  async function openSession(id) {
    const s = (await dbAll('sessions')).find(x => x.id === id);
    if (!s) return;
    S.s = s;
    S.events = await dbBySid('events', id);
    S.notes = await dbBySid('notes', id);
    rebuildIdx();
    S.view = 'session'; S.tab = 'count'; S.filter = null;
    S.lastInterval = intervalAt(Date.now());
    clearInterval(S.ticker);
    S.ticker = setInterval(tick, 250);
    if (isRunning()) acquireWake();
    render();
  }
  async function pauseNow() {
    const s = S.s;
    if (s && s.runStart > 0) {
      s.accMs += Date.now() - s.runStart;
      s.runStart = 0;
      await dbPut('sessions', s);
    }
    releaseWake();
  }
  async function closeSession() {
    await pauseNow();
    clearInterval(S.ticker);
    S.s = null; S.events = []; S.notes = []; S.view = 'list';
    await loadSessions();
    render();
  }
  async function startNow() {
    const s = S.s;
    if (!s || s.runStart > 0 || isFinished()) return;
    initAudio();
    s.runStart = Date.now();
    await dbPut('sessions', s);
    acquireWake();
    render();
  }
  async function finishNow() {
    const s = S.s;
    if (!s) return;
    await pauseNow();
    s.status = 'FINALIZADA'; s.endedAt = Date.now();
    await dbPut('sessions', s);
    render();
    toast('✔ Conteo finalizado y guardado');
  }
  function addEvent(m, v) {
    const s = S.s;
    if (!s || !isRunning() || isFinished()) return;
    initAudio();
    const t = Date.now();
    const e = { sid: s.id, time: t, approach: S.approach, movement: m, vehicle: v, interval: intervalAt(t) };
    S.events.push(e); idxAdd(e, 1);
    if (navigator.vibrate) navigator.vibrate(20);
    refreshCounts();
    e._p = dbAdd('events', { sid: e.sid, time: e.time, approach: e.approach, movement: e.movement, vehicle: e.vehicle, interval: e.interval })
      .then(k => { e.id = k; })
      .catch(err => toast('No se pudo guardar: ' + err.message));
  }
  async function undoLast() {
    if (isFinished()) return;
    const e = S.events[S.events.length - 1];
    if (!e) return;
    S.events.pop(); idxAdd(e, -1);
    refreshCounts();
    try { await e._p; if (e.id != null) await dbDel('events', e.id); } catch (err) { toast('Error al deshacer'); }
  }
  async function addNote(text) {
    const t = text.replace(/\s+/g, ' ').trim();
    if (!t) return;
    const n = { sid: S.s.id, time: Date.now(), interval: intervalAt(Date.now()), text: t };
    n.id = await dbAdd('notes', n);
    S.notes.push(n);
    if (S.view === 'session') renderBody();
  }
  async function deleteNote(id) {
    await dbDel('notes', id);
    S.notes = S.notes.filter(n => n.id !== id);
    renderBody();
  }
  function tick() {
    if (S.view !== 'session' || !S.s) return;
    const t = Date.now(), st = timerState(t);
    const set = (id, txt) => { const el = document.getElementById(id); if (el && el.textContent !== txt) el.textContent = txt; };
    set('tInt', 'Intervalo ' + (st.cur + 1));
    set('tRem', clock(st.rem));
    set('tInfo', 'Intervalos de ' + S.s.intervalMin + ' min · Tiempo total ' + clock(st.el));
    const bar = document.getElementById('tBar');
    if (bar) bar.style.width = st.pct.toFixed(1) + '%';
    if (st.cur !== S.lastInterval) {
      if (isRunning()) {
        const done = st.cur;   // número (1-based) del último intervalo completado
        intervalAlert(done, S.events.filter(e => e.interval === done - 1).length);
      }
      S.lastInterval = st.cur;
      refreshCounts();
    }
  }

  // ---------- Exportación ----------
  async function exportCurrent() {
    const s = S.s, t = Date.now();
    await Promise.all(S.events.map(e => e._p).filter(Boolean));
    await deliver(C.sessionFiles(s, S.events, S.notes, elapsedOf(s, t), isRunning(), t));
  }
  async function exportById(id) {
    const s = (await dbAll('sessions')).find(x => x.id === id);
    const ev = await dbBySid('events', id), nt = await dbBySid('notes', id), t = Date.now();
    await deliver(C.sessionFiles(s, ev, nt, elapsedOf(s, t), false, t));
  }
  async function exportAll() {
    const t = Date.now(), items = [];
    const all = (await dbAll('sessions')).sort((a, b) => a.createdAt - b.createdAt);
    for (const s of all) items.push({ session: s, events: await dbBySid('events', s.id), notes: await dbBySid('notes', s.id), elapsedMs: elapsedOf(s, t) });
    if (!items.length) return toast('No hay conteos para exportar');
    await deliver(C.allFiles(items, t));
  }
  async function backup() {
    const out = [];
    for (const s of await dbAll('sessions')) {
      const events = (await dbBySid('events', s.id)).map(e => ({ time: e.time, approach: e.approach, movement: e.movement, vehicle: e.vehicle, interval: e.interval }));
      const notes = (await dbBySid('notes', s.id)).map(n => ({ time: n.time, interval: n.interval, text: n.text }));
      out.push(Object.assign({}, s, { events, notes }));
    }
    if (!out.length) return toast('No hay conteos para respaldar');
    const json = JSON.stringify({ app: 'aforo-vehicular', v: 1, exportedAt: Date.now(), sessions: out });
    await deliver([{ name: 'Aforo_respaldo_' + C.stamp(Date.now()) + '.json', mime: 'application/json', data: json }]);
  }
  async function importBackup(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { throw new Error('el archivo no se puede leer'); }
    if (!data || data.app !== 'aforo-vehicular' || !Array.isArray(data.sessions)) throw new Error('no es un respaldo de Aforo Vehicular');
    const keyOf = s => [s.createdAt, s.counter || '', s.zone, s.site].join('|');
    const have = new Set((await dbAll('sessions')).map(keyOf));
    let added = 0, skipped = 0;
    for (const item of data.sessions) {
      if (have.has(keyOf(item))) { skipped++; continue; }
      const meta = Object.assign({}, item);
      const events = meta.events || [], notes = meta.notes || [];
      delete meta.events; delete meta.notes; delete meta.id; delete meta.total;
      meta.runStart = 0;
      const sid = await dbAdd('sessions', meta);
      await dbAddMany('events', events.map(e => ({ sid, time: e.time, approach: e.approach, movement: e.movement, vehicle: e.vehicle, interval: e.interval })));
      await dbAddMany('notes', notes.map(n => ({ sid, time: n.time, interval: n.interval, text: n.text })));
      added++;
    }
    await loadSessions(); render();
    toast('Importados ' + added + ' conteo(s)' + (skipped ? ' · ' + skipped + ' ya estaban' : ''), 5000);
  }

  // ---------- Vistas ----------
  const isStandalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

  function listHtml() {
    const hint = (!isStandalone() && !localStorage.getItem('aforo.hint'))
      ? '<div class="card hint"><b>Instala la app en tu celular</b><p class="muted" style="color:inherit">' +
        (isIOS() ? 'En Safari toca Compartir ⬆ y elige «Añadir a pantalla de inicio». Usa siempre ese ícono: así funciona sin internet y no se pierden los datos.'
          : 'En Chrome abre el menú ⋮ y elige «Instalar app» o «Añadir a pantalla de inicio». Así funciona sin internet.') +
        '</p><button class="btn" data-a="hint-x">Entendido</button></div>' : '';
    const cards = S.sessions.map(s => {
      const done = s.status === 'FINALIZADA';
      return '<article class="card"><h3>' + esc(s.zone) + ' · ' + esc(s.site) + '</h3>' +
        '<div class="muted">' + C.fmtDate(s.createdAt) + ' ' + C.fmtTime(s.createdAt) + (s.counter ? ' · Aforista: ' + esc(s.counter) : '') + '</div>' +
        '<div>Intervalos de ' + s.intervalMin + ' min · <b>' + s.total + '</b> vehículos · ' + clock(s.accMs) + ' ' +
        (done ? '<span class="tag ok">Finalizado</span>' : '<span class="tag run">En curso</span>') + '</div>' +
        '<div class="acts"><button class="btn primary" data-a="open" data-id="' + s.id + '">' + (done ? 'Ver' : 'Continuar') + '</button>' +
        '<button class="btn" data-a="exp" data-id="' + s.id + '">Exportar</button>' +
        '<button class="btn danger" data-a="del" data-id="' + s.id + '">Eliminar</button></div></article>';
    }).join('');
    return '<header class="top"><h1>Estudios de aforo</h1></header><div class="stripe"></div><main>' + hint +
      '<button class="btn primary big" data-a="new">＋ Nuevo conteo</button>' +
      '<div class="row"><button class="btn" data-a="export-all">Exportar todos (Excel + CSV)</button></div>' +
      '<div class="row"><button class="btn" data-a="backup">Guardar respaldo</button><button class="btn" data-a="import">Importar respaldo</button></div>' +
      (cards || '<p class="muted">Aún no hay conteos guardados. Pulsa «Nuevo conteo» para empezar.</p>') +
      '<p class="muted" style="text-align:center">Aforo Vehicular v' + VERSION + ' · los datos se guardan en este dispositivo</p></main>';
  }

  function sessionHtml() {
    const s = S.s;
    return '<header class="top"><button class="back" data-a="back">← Conteos</button><div class="ttl"><b>' + esc(s.zone) + '</b><span>' +
      esc(s.site) + (s.counter ? ' · ' + esc(s.counter) : '') + '</span></div></header><div class="stripe"></div>' +
      '<nav class="tabs" role="tablist"><button role="tab" data-a="tab" data-tab="count" aria-selected="' + (S.tab === 'count') + '">Conteo</button>' +
      '<button role="tab" data-a="tab" data-tab="stats" aria-selected="' + (S.tab === 'stats') + '">Estadísticas</button></nav>' +
      '<main id="body">' + (S.tab === 'count' ? countHtml() : statsHtml()) + '</main>';
  }

  function countHtml() {
    const s = S.s, t = Date.now(), st = timerState(t), run = isRunning(), fin = isFinished();
    const state = fin ? 'Finalizado' : run ? 'Contando' : (s.accMs > 0 ? 'En pausa' : 'Sin iniciar');
    let main;
    if (fin) main = '<p><b>✔ Conteo finalizado y guardado.</b> Puedes exportarlo o consultarlo cuando quieras.</p>';
    else if (run) main = '<button class="btn big" data-a="pause">⏸ Pausar</button>';
    else main = '<button class="btn primary big" data-a="start">' + (s.accMs > 0 ? '▶ Continuar' : '▶ Iniciar conteo') + '</button>';

    const heads = MOVES.map(m => '<div class="gh" style="color:' + m.color + '">' + m.n + '</div>').join('');
    const rows = VEHICLES.map(v => '<div class="vl"><span>' + v.icon + '</span>' + v.n + '</div>' + MOVES.map(m =>
      '<button class="cnt" data-a="cnt" data-m="' + m.k + '" data-v="' + v.k + '" style="--c:' + m.color + ';--fg:' + m.fg + '"' + (run ? '' : ' disabled') +
      ' aria-label="' + v.n + ' ' + m.n + '"><span class="ar">' + m.icon + '</span><span class="n">' + cnt(st.cur, S.approach, m.k, v.k) + '</span></button>').join('')).join('');

    return '<section class="card timer"><div class="t-row"><span id="tInt" class="t-int">Intervalo ' + (st.cur + 1) + '</span><span class="tag">' + state + '</span></div>' +
      '<div id="tRem" class="clock">' + clock(st.rem) + '</div><div class="bar"><i id="tBar" style="width:' + st.pct.toFixed(1) + '%"></i></div>' +
      '<div id="tInfo" class="muted">Intervalos de ' + s.intervalMin + ' min · Tiempo total ' + clock(st.el) + '</div>' + main +
      (fin ? '' : '<div class="muted">Cada toque se guarda al instante. Al terminar cada intervalo suena un aviso.</div>') + '</section>' +
      '<div class="sec">Acceso (de dónde vienen los vehículos)</div><div class="chips">' +
      APPROACHES.map(a => '<button class="chip" data-a="approach" data-k="' + a.k + '" aria-pressed="' + (S.approach === a.k) + '">' + a.n + '</button>').join('') + '</div>' +
      '<div class="sec">Un toque = vehículo + movimiento</div><div class="grid"><div></div>' + heads + rows + '</div>' +
      '<div class="muted">Los números son del intervalo en curso · acceso ' + C.approachName(S.approach) + '</div>' +
      '<div class="row"><button class="btn" data-a="undo"' + (fin ? ' disabled' : '') + '>Deshacer</button><button class="btn" data-a="note">💬 Observación</button></div>' +
      '<div class="row"><button class="btn primary" data-a="export"' + (S.events.length ? '' : ' disabled') + '>Exportar Excel</button>' +
      '<button class="btn" data-a="finish"' + ((fin || !(run || s.accMs > 0)) ? ' disabled' : '') + '>Finalizar y guardar</button></div>' +
      '<section class="card" id="tables">' + tablesHtml() + '</section>';
  }

  function tablesHtml() {
    const t = Date.now(), cur = intervalAt(t), a = S.approach;
    const last = Math.max(cur, C.maxInterval(S.events));
    const per = Array.from({ length: last + 1 }, () => [0, 0, 0]);
    const byApp = {}; APPROACHES.forEach(x => { byApp[x.k] = [0, 0, 0]; });
    S.events.forEach(e => {
      const mi = MOVES.findIndex(m => m.k === e.movement);
      if (mi < 0) return;
      if (byApp[e.approach]) byApp[e.approach][mi]++;
      if (e.approach === a && e.interval <= last) per[e.interval][mi]++;
    });
    let rows = '';
    for (let i = last; i >= 0; i--) rows += '<tr><td>' + (i + 1) + (i === cur ? '*' : '') + '</td>' + per[i].map(n => '<td>' + n + '</td>').join('') + '<td><b>' + C.sum(per[i]) + '</b></td></tr>';
    const head = '<tr><th>' + 'Int.' + '</th><th>Izq</th><th>Frente</th><th>Der</th><th>Total</th></tr>';
    const apps = APPROACHES.map(x => '<tr><td>' + x.n + '</td>' + byApp[x.k].map(n => '<td>' + n + '</td>').join('') + '<td><b>' + C.sum(byApp[x.k]) + '</b></td></tr>').join('');
    return '<div class="sec">Por intervalo · acceso ' + C.approachName(a) + '</div><table>' + head + rows + '</table><div class="muted">* intervalo en curso</div>' +
      '<div class="sec" style="margin-top:8px">Total por acceso (' + S.events.length + ' vehículos)</div><table><tr><th>Acceso</th><th>Izq</th><th>Frente</th><th>Der</th><th>Total</th></tr>' + apps + '</table>';
  }

  function barsHtml(stacks, colors, noted) {
    const H = 150, max = Math.max(1, ...stacks.map(C.sum));
    return '<div class="bars">' + stacks.map((seg, i) => {
      const tot = C.sum(seg), h = Math.round(H * tot / max);
      return '<div class="bar-col"><span>' + tot + '</span><div class="stack" style="height:' + h + 'px">' +
        seg.map((v, j) => v > 0 ? '<i style="flex:' + v + ';background:' + colors[j] + '"></i>' : '').join('') + '</div><span>' + (i + 1) + (noted.has(i) ? '💬' : '') + '</span></div>';
    }).join('') + '</div>';
  }
  function hbarsHtml(items, color) {
    const total = C.sum(items.map(x => x[1])), max = Math.max(1, ...items.map(x => x[1]));
    return '<div style="display:flex;flex-direction:column;gap:6px">' + items.map(x =>
      '<div class="hb"><span>' + esc(x[0]) + '</span><span class="ht"><i style="width:' + (x[1] / max * 100) + '%;background:' + color + '"></i></span><span class="hv">' + x[1] + ' (' + C.pct(x[1], total) + '%)</span></div>').join('') + '</div>';
  }

  function statsHtml() {
    const t = Date.now(), cur = intervalAt(t), last = Math.max(cur, C.maxInterval(S.events));
    const evs = S.events.filter(e => !S.filter || e.approach === S.filter);
    const st = Array.from({ length: last + 1 }, () => [0, 0, 0]);
    evs.forEach(e => { const mi = MOVES.findIndex(m => m.k === e.movement); if (mi >= 0 && e.interval <= last) st[e.interval][mi]++; });
    const noted = new Set(S.notes.map(n => n.interval));
    const colors = MOVES.map(m => m.color);
    const comments = C.buildComments(S.events, S.s.intervalMin, cur, isRunning());
    const notes = S.notes.slice().sort((a, b) => b.time - a.time).map(n =>
      '<div class="note"><span>Int. ' + (n.interval + 1) + ' · ' + C.fmtTime(n.time) + ' — ' + esc(n.text) + '</span><button data-a="delnote" data-id="' + n.id + '" aria-label="Borrar observación">✕</button></div>').join('');
    return '<div class="sec">Filtrar por acceso</div><div class="chips"><button class="chip" data-a="filter" data-k="" aria-pressed="' + (!S.filter) + '">Todos</button>' +
      APPROACHES.map(a => '<button class="chip" data-a="filter" data-k="' + a.k + '" aria-pressed="' + (S.filter === a.k) + '">' + a.n + '</button>').join('') + '</div>' +
      '<section class="card"><h3>Volumen por intervalo (' + S.s.intervalMin + ' min)</h3>' + barsHtml(st.map(r => [C.sum(r)]), ['var(--bar)'], noted) + '<div class="muted">💬 = intervalo con observación</div></section>' +
      '<section class="card"><h3>Movimientos por intervalo</h3>' + barsHtml(st, colors, noted) +
      '<div class="legend">' + MOVES.map(m => '<span><b style="background:' + m.color + '"></b>' + m.n + '</span>').join('') + '</div></section>' +
      '<section class="card"><h3>Distribución por movimiento</h3>' + hbarsHtml(MOVES.map(m => [m.n, evs.filter(e => e.movement === m.k).length]), 'var(--bar)') + '</section>' +
      '<section class="card"><h3>Tipo de vehículo</h3>' + hbarsHtml(VEHICLES.map(v => [v.n, evs.filter(e => e.vehicle === v.k).length]), 'var(--bar)') + '</section>' +
      '<section class="card"><h3>Volumen por acceso</h3>' + hbarsHtml(APPROACHES.map(a => [a.n, S.events.filter(e => e.approach === a.k).length]), 'var(--bar)') + '</section>' +
      '<section class="card"><h3>Análisis automático</h3><ul class="comments">' + comments.map(c => '<li>' + esc(c) + '</li>').join('') + '</ul></section>' +
      '<section class="card"><h3>Observaciones del aforista</h3>' + (notes || '<p class="muted">Sin observaciones todavía.</p>') +
      '<button class="btn" data-a="note">💬 Agregar observación</button></section>';
  }

  function refreshCounts() {
    if (S.view !== 'session' || S.tab !== 'count') return;
    const cur = intervalAt(Date.now());
    document.querySelectorAll('.cnt').forEach(b => {
      const n = b.querySelector('.n');
      const v = String(cnt(cur, S.approach, b.dataset.m, b.dataset.v));
      if (n && n.textContent !== v) n.textContent = v;
    });
    const tb = document.getElementById('tables');
    if (tb) tb.innerHTML = tablesHtml();
    const ex = document.querySelector('[data-a="export"]');
    if (ex) ex.disabled = S.events.length === 0;
  }
  function renderBody() {
    const b = document.getElementById('body');
    if (b) b.innerHTML = S.tab === 'count' ? countHtml() : statsHtml();
    document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', String(x.dataset.tab === S.tab)));
  }
  function render() { $app.innerHTML = S.view === 'list' ? listHtml() : sessionHtml(); }

  // ---------- Formularios ----------
  function newSessionForm() {
    const saved = localStorage.getItem('aforo.counter') || '';
    modal({
      title: 'Nuevo conteo',
      body: '<div style="display:flex;flex-direction:column;gap:10px">' +
        '<label>Zona<input id="fZone" placeholder="Ej.: Laureles" autocomplete="off"></label>' +
        '<label>Intersección<input id="fSite" placeholder="Ej.: Cra 70 con Cl 44" autocomplete="off"></label>' +
        '<label>Aforista (quien cuenta)<input id="fCounter" value="' + esc(saved) + '" placeholder="Tu nombre" autocomplete="off"></label>' +
        '<label>Duración del intervalo<select id="fInt"><option value="5">5 min</option><option value="10">10 min</option><option value="15" selected>15 min</option><option value="30">30 min</option><option value="60">60 min</option></select></label></div>',
      actions: [{ label: 'Cancelar' }, {
        label: 'Iniciar', kind: 'primary',
        fn: async w => {
          const v = id => w.querySelector('#' + id).value.trim();
          const counter = v('fCounter');
          localStorage.setItem('aforo.counter', counter);
          const s = {
            zone: v('fZone') || 'Sin zona', site: v('fSite') || 'Sin nombre', counter, createdAt: Date.now(), endedAt: 0,
            intervalMin: Number(w.querySelector('#fInt').value), status: 'EN_CURSO', accMs: 0, runStart: 0
          };
          s.id = await dbAdd('sessions', s);
          await openSession(s.id);
        }
      }]
    });
  }
  function noteForm() {
    modal({
      title: 'Observación · intervalo ' + (intervalAt(Date.now()) + 1),
      body: '<textarea id="fNote" rows="3" placeholder="Ej.: lluvia, obra, accidente, semáforo dañado"></textarea>',
      actions: [{ label: 'Cancelar' }, { label: 'Guardar', kind: 'primary', fn: w => addNote(w.querySelector('#fNote').value) }]
    });
  }

  // ---------- Acciones ----------
  const actions = {
    'new': () => newSessionForm(),
    'open': el => openSession(Number(el.dataset.id)),
    'exp': el => exportById(Number(el.dataset.id)),
    'del': async el => {
      const s = S.sessions.find(x => x.id === Number(el.dataset.id));
      if (s && await confirmBox('¿Eliminar este conteo?', s.zone + ' · ' + s.site + '\nSe borrarán sus ' + s.total + ' vehículos. No se puede deshacer.', 'Eliminar')) {
        await dbDeleteSession(s.id); await loadSessions(); render();
      }
    },
    'export-all': () => exportAll(),
    'backup': () => backup(),
    'import': () => document.getElementById('importFile').click(),
    'hint-x': () => { localStorage.setItem('aforo.hint', '1'); render(); },
    'back': () => closeSession(),
    'tab': el => { S.tab = el.dataset.tab; renderBody(); },
    'approach': el => { S.approach = el.dataset.k; renderBody(); },
    'filter': el => { S.filter = el.dataset.k || null; renderBody(); },
    'start': () => startNow(),
    'pause': async () => { await pauseNow(); render(); },
    'cnt': el => addEvent(el.dataset.m, el.dataset.v),
    'undo': () => undoLast(),
    'note': () => noteForm(),
    'delnote': el => deleteNote(Number(el.dataset.id)),
    'export': () => exportCurrent(),
    'finish': async () => {
      if (await confirmBox('¿Finalizar y guardar?', 'El conteo queda guardado y ya no podrás agregar vehículos. Podrás verlo y exportarlo desde la lista de conteos.', 'Finalizar')) await finishNow();
    }
  };
  document.addEventListener('click', ev => {
    const el = ev.target.closest('[data-a]');
    if (!el || el.disabled) return;
    const h = actions[el.dataset.a];
    if (h) Promise.resolve().then(() => h(el)).catch(err => toast('Error: ' + err.message));
  });
  document.getElementById('importFile').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (f) { try { await importBackup(f); } catch (err) { toast('No se pudo importar: ' + err.message, 5000); } }
  });

  // ---------- Inicio ----------
  (async () => {
    try {
      db = await openDb();
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
      await loadSessions();
      render();
    } catch (err) {
      $app.innerHTML = '<p class="boot">No se pudo abrir el almacenamiento del navegador: ' + esc(err.message) + '<br>Si usas navegación privada, ábrela en una ventana normal.</p>';
    }
    if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  })();
})();
