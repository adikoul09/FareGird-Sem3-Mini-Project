/* ==========================================================================
   FareGrid — front-end
   The Floyd–Warshall computation runs in the C engine compiled to
   WebAssembly (engine/floyd_core.c → floyd.wasm, see engine.js);
   this file builds the network, replays the engine's trace and renders views.
   ========================================================================== */
'use strict';

(() => {
  /* ------------------------------- helpers ------------------------------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const f1 = v => v.toFixed(1);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const clone = m => m.map(r => r.slice());
  const toNum = v => (v === null ? Infinity : v === '-inf' ? -Infinity : v);
  const fmt = v => (v === Infinity ? '∞' : v === -Infinity ? '−∞' : v < 0 ? '−' + Math.abs(v) : String(v));
  const noEdge = v => v === null || v === Infinity;
  const short = (s, n = 13) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const MAX = 20, LIMIT = 1000000, NAME_LEN = 29;
  const R = 20;

  /* ------------------------------- presets ------------------------------- */
  const PRESETS = [
    {
      id: 'mh', title: 'Maharashtra & Goa', tag: 'Positive costs', accent: 'var(--amber)',
      desc: 'Road costs in ₹ on one-way roads between five cities.',
      icon: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
      names: ['Mumbai', 'Pune', 'Nashik', 'Nagpur', 'Goa'],
      edges: [[0, 1, 150], [0, 2, 170], [1, 0, 150], [1, 2, 210], [1, 3, 700],
              [2, 0, 170], [2, 3, 450], [3, 0, 800], [4, 0, 590], [4, 1, 450],
              [0, 4, 590], [1, 4, 450]],
    },
    {
      id: 'gj', title: 'Gujarat discounts', tag: 'Negative edges', accent: 'var(--violet)',
      desc: 'Rebates as negative costs, no negative cycle (CLRS).',
      icon: '<path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
      names: ['Surat', 'Vadodara', 'Ahmedabad', 'Rajkot', 'Bhuj'],
      edges: [[0, 1, 3], [0, 2, 8], [0, 4, -4], [1, 3, 1], [1, 4, 7],
              [2, 1, 4], [3, 0, 2], [3, 2, -5], [4, 3, 6]],
    },
    {
      id: 'nc', title: 'North India loop', tag: 'Negative cycle', accent: 'var(--coral)',
      desc: 'Delhi → Agra → Jaipur → Delhi sums to −1.',
      icon: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
      names: ['Delhi', 'Agra', 'Jaipur', 'Udaipur', 'Shimla'],
      edges: [[0, 1, 4], [1, 2, -6], [2, 0, 1], [2, 3, 2], [4, 0, 3]],
    },
  ];
  const CITY_POOL = ['Mumbai', 'Pune', 'Nashik', 'Nagpur', 'Goa', 'Surat', 'Indore', 'Bhopal',
    'Jaipur', 'Delhi', 'Agra', 'Hyderabad', 'Bengaluru', 'Chennai', 'Kochi', 'Kolkata',
    'Lucknow', 'Ahmedabad', 'Udaipur', 'Mysuru', 'Aurangabad', 'Kolhapur'];

  /* -------------------------------- state -------------------------------- */
  const state = {
    names: [], cost: [], pos: {}, preset: null, bad: new Set(),
    result: null, events: [], stageEv: [], ev: 0,
    playing: false, timer: 0, speed: 1, mode: 'update',
    view: 'network', visBuilt: false, routeBuilt: false,
    src: 0, dst: 0, carRaf: 0, undo: null,
  };

  const emptyMatrix = n => Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 0 : null)));

  function presetData(p) {
    const cost = emptyMatrix(p.names.length);
    p.edges.forEach(([i, j, w]) => { cost[i][j] = w; });
    return { names: p.names.slice(), cost };
  }

  function save() {
    try {
      localStorage.setItem('fw-network', JSON.stringify(
        { names: state.names, cost: state.cost, pos: state.pos, preset: state.preset }));
    } catch (e) { /* storage unavailable */ }
  }

  function loadSaved() {
    try {
      const d = JSON.parse(localStorage.getItem('fw-network'));
      if (!d || !Array.isArray(d.names) || !Array.isArray(d.cost)) return null;
      const n = d.names.length;
      if (n > MAX || d.cost.length !== n || d.cost.some(r => !Array.isArray(r) || r.length !== n)) return null;
      return d;
    } catch (e) { return null; }
  }

  function snapshot() {
    return JSON.parse(JSON.stringify(
      { names: state.names, cost: state.cost, pos: state.pos, preset: state.preset }));
  }

  function restore(s) {
    Object.assign(state, s);
    state.bad.clear();
    invalidate();
    renderNetwork(true);
    save();
  }

  /* -------------------------------- toasts ------------------------------- */
  function toast(msg, type = 'ok', action) {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML = `<span class="t-ic"></span><span>${msg}</span>`;
    if (action) {
      const b = document.createElement('button');
      b.textContent = action.label;
      b.onclick = () => { action.run(); dismiss(); };
      el.appendChild(b);
    }
    $('#toasts').appendChild(el);
    let gone = false;
    function dismiss() {
      if (gone) return;
      gone = true;
      el.classList.add('out');
      setTimeout(() => el.remove(), 350);
    }
    setTimeout(dismiss, action ? 6000 : 3600);
  }

  /* ======================================================================
     GRAPH RENDERING (shared by all views)
     ====================================================================== */
  function defaultPos(n, i) {
    if (n === 1) return { x: 320, y: 215 };
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return { x: 320 + 235 * Math.cos(a), y: 212 + 168 * Math.sin(a) };
  }
  const posOf = (names, i) => state.pos[names[i]] || defaultPos(names.length, i);

  function toward(p, q, d) {
    const dx = q.x - p.x, dy = q.y - p.y, l = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / l) * d, y: p.y + (dy / l) * d };
  }

  /* Quadratic curve from a to b, bent sideways by `bend`, trimmed at nodes. */
  function geom(a, b, bend, padS = R + 3, padE = R + 4) {
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const c = { x: (a.x + b.x) / 2 + nx * bend, y: (a.y + b.y) / 2 + ny * bend };
    const s = toward(a, c, padS), e = toward(b, c, padE);
    return {
      d: `M${f1(s.x)} ${f1(s.y)} Q${f1(c.x)} ${f1(c.y)} ${f1(e.x)} ${f1(e.y)}`,
      mx: 0.25 * s.x + 0.5 * c.x + 0.25 * e.x,
      my: 0.25 * s.y + 0.5 * c.y + 0.25 * e.y,
    };
  }

  function label(x, y, text, cls) {
    const w = 12 + text.length * 6.7;
    return `<g class="${cls}" transform="translate(${f1(x)},${f1(y)})">` +
      `<rect x="${f1(-w / 2)}" y="-9.5" width="${f1(w)}" height="19" rx="6"/><text>${text}</text></g>`;
  }

  const MARKERS = ['def', 'neg', 'teal', 'amber', 'coral'];
  const markerDefs = id => MARKERS.map(k =>
    `<marker id="${id}-${k}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="4.6" markerHeight="4.6" orient="auto">` +
    `<path class="mk-${k}" d="M0 0L10 5L0 10z"/></marker>`).join('');

  /* cfg: { names, cost, animate, nodeClass(i), edgeClass(i,j), overlay(P) below labels, overlayTop(P) above } */
  function renderGraph(svg, cfg) {
    const { names, cost } = cfg;
    const n = names.length, id = svg.id;
    const P = names.map((_, i) => posOf(names, i));
    let edges = '', labels = '';
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j || noEdge(cost[i][j])) continue;
        const w = cost[i][j];
        const g = geom(P[i], P[j], noEdge(cost[j][i]) ? 0 : 24);
        const ec = cfg.edgeClass ? cfg.edgeClass(i, j) : '';
        const neg = w < 0;
        const mk = ec.includes('on-route') ? 'teal' : neg ? 'neg' : 'def';
        const gc = `edge ${neg ? 'neg' : ''} ${ec}`;
        edges += `<g class="${gc}"><path class="e" d="${g.d}" marker-end="url(#${id}-${mk})"/></g>`;
        labels += `<g class="${gc}">${label(g.mx, g.my, fmt(w), 'w')}</g>`;
      }
    }
    let nodes = '';
    for (let i = 0; i < n; i++) {
      const nc = cfg.nodeClass ? cfg.nodeClass(i) : '';
      nodes += `<g class="node ${cfg.animate ? 'in' : ''} ${nc}" data-i="${i}" transform="translate(${f1(P[i].x)},${f1(P[i].y)})">` +
        `<g class="ni" style="animation-delay:${i * 45}ms"><circle class="halo" r="31"/><circle class="core" r="${R}"/>` +
        `<text class="nid">${i + 1}</text><text class="lbl" y="${R + 17}">${esc(short(names[i]))}</text></g></g>`;
    }
    svg.innerHTML = `<defs>${markerDefs(id)}</defs><g class="edges">${edges}</g>` +
      `<g class="ov">${cfg.overlay ? cfg.overlay(P) : ''}</g><g class="labels">${labels}</g>` +
      `<g class="ov">${cfg.overlayTop ? cfg.overlayTop(P) : ''}</g><g class="nodes">${nodes}</g>`;
    svg._names = names;
  }

  /* Node dragging (positions shared across every view). */
  function enableDrag(svg) {
    let drag = null, pending = false;
    const toSvg = e => {
      const p = svg.createSVGPoint();
      p.x = e.clientX; p.y = e.clientY;
      return p.matrixTransform(svg.getScreenCTM().inverse());
    };
    svg.addEventListener('pointerdown', e => {
      const g = e.target.closest('.node');
      if (!g || !svg._names) return;
      drag = { name: svg._names[+g.dataset.i] };
      svg.setPointerCapture(e.pointerId);
      svg.classList.add('dragging');
      e.preventDefault();
    });
    svg.addEventListener('pointermove', e => {
      if (!drag) return;
      const p = toSvg(e);
      state.pos[drag.name] = { x: clamp(p.x, 34, 606), y: clamp(p.y, 34, 418) };
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; if (svg._render) svg._render(); });
    });
    const end = () => {
      if (!drag) return;
      drag = null;
      svg.classList.remove('dragging');
      if (svg._render) svg._render();
      save();
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
  }

  /* ======================================================================
     NETWORK VIEW
     ====================================================================== */
  function renderPresets() {
    $('#presets').innerHTML = PRESETS.map((p, i) =>
      `<button class="preset ${state.preset === p.id ? 'is-current' : ''}" style="--accent:${p.accent}" data-preset="${i}">` +
      `<span class="preset-icon"><svg viewBox="0 0 24 24">${p.icon}</svg></span>` +
      `<span class="preset-title">${p.title}</span><span class="preset-desc">${p.desc}</span>` +
      `<span class="preset-tag">${p.tag}</span></button>`).join('') +
      `<div class="preset-row"><button class="btn btn-soft" data-random>` +
      `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.2"/><circle cx="15.5" cy="15.5" r="1.2"/><circle cx="15.5" cy="8.5" r="1.2"/><circle cx="8.5" cy="15.5" r="1.2"/></svg>` +
      `Generate random network</button></div>`;
  }

  function renderChips() {
    $('#cityChips').innerHTML = state.names.map((nm, i) =>
      `<span class="chip" style="animation-delay:${i * 25}ms"><span class="idx">${i + 1}</span>${esc(nm)}` +
      `<button type="button" data-remove="${i}" aria-label="Remove ${esc(nm)}">` +
      `<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></span>`).join('');
  }

  function renderCostTable() {
    const t = $('#costTable'), n = state.names.length;
    state.bad.clear();
    if (!n) {
      t.innerHTML = '<tbody><tr><td style="padding:24px;color:var(--dim);font-family:var(--font-body)">No cities yet. Add one above or pick a sample.</td></tr></tbody>';
      return;
    }
    const head = state.names.map((nm, j) =>
      `<th title="${esc(nm)}"><span class="th-idx">${j + 1}</span>${esc(short(nm, 10))}</th>`).join('');
    const rows = state.names.map((nm, i) => {
      const cells = state.names.map((nj, j) => {
        if (i === j) return '<td class="diag"><div class="cell">0</div></td>';
        const v = state.cost[i][j];
        return `<td><input data-i="${i}" data-j="${j}" value="${v === null ? '' : v}" placeholder="∞" ` +
          `inputmode="numeric" class="${v !== null && v < 0 ? 'neg' : ''}" aria-label="Cost from ${esc(nm)} to ${esc(nj)}"></td>`;
      }).join('');
      return `<tr><th title="${esc(nm)}"><span class="th-idx">${i + 1}</span>${esc(short(nm, 12))}</th>${cells}</tr>`;
    }).join('');
    t.innerHTML = `<thead><tr><th>From \\ To</th>${head}</tr></thead><tbody>${rows}</tbody>`;
  }

  function renderNetGraph(animate) {
    const svg = $('#netGraph');
    $('#netEmpty').hidden = state.names.length > 0;
    renderGraph(svg, { names: state.names, cost: state.cost, animate });
    svg._render = () => renderNetGraph(false);
  }

  function renderSummary() {
    const n = state.names.length;
    let edges = 0, neg = 0;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        if (i !== j && state.cost[i][j] !== null) { edges++; if (state.cost[i][j] < 0) neg++; }
    const bad = state.bad.size;
    $('#netSummary').innerHTML =
      `<span><b>${n}</b>cities</span><span><b>${edges}</b>direct roads</span>` +
      `<span class="${neg ? 'warn' : ''}"><b>${neg}</b>negative</span>` +
      (bad ? `<span class="warn"><b>${bad}</b>invalid ${bad === 1 ? 'cell' : 'cells'}</span>` : '');
    $('#runBtn').disabled = n === 0 || bad > 0;
  }

  function renderNetwork(animate) {
    renderPresets();
    renderChips();
    renderCostTable();
    renderNetGraph(animate);
    renderSummary();
  }

  function setNetwork(names, cost, preset, msg) {
    const prev = snapshot();
    state.names = names;
    state.cost = cost;
    state.pos = {};
    state.preset = preset;
    invalidate();
    renderNetwork(true);
    save();
    if (msg) toast(msg, 'ok', prev.names.length ? { label: 'Undo', run: () => restore(prev) } : null);
  }

  function randomNetwork() {
    const n = 6 + Math.floor(Math.random() * 2);
    const names = CITY_POOL.slice().sort(() => Math.random() - 0.5).slice(0, n);
    const cost = emptyMatrix(n);
    const rnd = () => (4 + Math.floor(Math.random() * 86)) * 10;
    for (let i = 0; i < n; i++) cost[i][(i + 1) % n] = rnd();   // ring keeps it connected
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        if (i !== j && cost[i][j] === null && Math.random() < 0.22) cost[i][j] = rnd();
    setNetwork(names, cost, null, `Random network with ${n} cities generated`);
  }

  function parseCell(str) {
    const s = str.trim().toLowerCase();
    if (s === '' || s === '∞' || s === 'inf' || s === 'x' || s === '-') return { ok: true, v: null };
    if (!/^-?\d+$/.test(s)) return { ok: false };
    const v = parseInt(s, 10);
    return Math.abs(v) <= LIMIT ? { ok: true, v } : { ok: false };
  }

  function addCity(raw) {
    const name = raw.replace(/\s+/g, ' ').trim().slice(0, NAME_LEN);
    const form = $('#addCityForm');
    const fail = msg => {
      toast(msg, 'error');
      form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
    };
    if (!name) return fail('Enter a city name.');
    if (state.names.length >= MAX) return fail(`At most ${MAX} cities are supported.`);
    if (state.names.some(c => c.toLowerCase() === name.toLowerCase())) return fail(`${esc(name)} is already in the network.`);
    state.names.push(name);
    state.cost.forEach(r => r.push(null));
    state.cost.push(state.names.map((_, j) => (j === state.names.length - 1 ? 0 : null)));
    state.preset = null;
    invalidate();
    renderNetwork(false);
    save();
    $('#cityInput').value = '';
  }

  function removeCity(i) {
    const prev = snapshot();
    const name = state.names[i];
    state.names.splice(i, 1);
    state.cost.splice(i, 1);
    state.cost.forEach(r => r.splice(i, 1));
    delete state.pos[name];
    state.preset = null;
    invalidate();
    renderNetwork(false);
    save();
    toast(`Removed ${esc(name)}`, 'ok', { label: 'Undo', run: () => restore(prev) });
  }

  function focusCell(i, j, di, dj) {
    const n = state.names.length;
    do { i += di; j += dj; } while (i === j && i >= 0 && i < n && j >= 0 && j < n);
    if (i < 0 || j < 0 || i >= n || j >= n) return;
    const el = $(`#costTable input[data-i="${i}"][data-j="${j}"]`);
    if (el) { el.focus(); el.select(); }
  }

  function bindNetwork() {
    $('#presets').addEventListener('click', e => {
      const b = e.target.closest('[data-preset]');
      if (b) {
        const p = PRESETS[+b.dataset.preset];
        const d = presetData(p);
        setNetwork(d.names, d.cost, p.id, `Loaded “${p.title}”`);
      } else if (e.target.closest('[data-random]')) randomNetwork();
    });

    $('#addCityForm').addEventListener('submit', e => { e.preventDefault(); addCity($('#cityInput').value); });
    $('#cityChips').addEventListener('click', e => {
      const b = e.target.closest('[data-remove]');
      if (b) removeCity(+b.dataset.remove);
    });

    const table = $('#costTable');
    table.addEventListener('input', e => {
      const t = e.target;
      if (!t.matches('input')) return;
      const i = +t.dataset.i, j = +t.dataset.j, key = i + ',' + j;
      const r = parseCell(t.value);
      if (!r.ok) {
        t.classList.add('bad');
        state.bad.add(key);
      } else {
        t.classList.remove('bad');
        state.bad.delete(key);
        state.cost[i][j] = r.v;
        t.classList.toggle('neg', r.v !== null && r.v < 0);
      }
      if (state.preset) { state.preset = null; renderPresets(); }
      invalidate();
      renderNetGraph(false);
      renderSummary();
      save();
    });
    table.addEventListener('keydown', e => {
      const t = e.target;
      if (!t.matches('input')) return;
      const i = +t.dataset.i, j = +t.dataset.j;
      const atStart = t.selectionStart === 0 && t.selectionEnd === 0;
      const atEnd = t.selectionStart === t.value.length;
      if (e.key === 'ArrowUp') { e.preventDefault(); focusCell(i, j, -1, 0); }
      else if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); focusCell(i, j, 1, 0); }
      else if (e.key === 'ArrowLeft' && atStart) { e.preventDefault(); focusCell(i, j, 0, -1); }
      else if (e.key === 'ArrowRight' && atEnd) { e.preventDefault(); focusCell(i, j, 0, 1); }
    });

    $('#clearBtn').addEventListener('click', () => {
      if (!state.names.length) return;
      setNetwork([], [], null, 'Network cleared');
    });
    $('#runBtn').addEventListener('click', run);
  }

  /* ======================================================================
     RUN (C engine)
     ====================================================================== */
  function invalidate() {
    if (!state.result) return;
    pause();
    cancelAnimationFrame(state.carRaf);
    state.result = null;
    state.visBuilt = state.routeBuilt = false;
    state.ev = 0;
    updateTabs();
  }

  function normalize(res) {
    const N = m => m.map(r => r.map(toNum));
    res.cost = N(res.cost);
    res.dist = N(res.dist);
    res.diag = res.diag.map(toNum);
    res.stages.forEach(s => {
      s.dist = N(s.dist);
      s.updates = s.updates.map(u => [u[0], u[1], toNum(u[2]), toNum(u[3])]);
    });
    res.initial = clone(res.cost);
    let unreach = 0;
    for (let i = 0; i < res.n; i++)
      for (let j = 0; j < res.n; j++)
        if (i !== j && res.dist[i][j] === Infinity) unreach++;
    res.unreach = unreach;
    return res;
  }

  async function run() {
    if (!state.names.length || state.bad.size) return;
    const btn = $('#runBtn');
    btn.classList.add('is-loading');
    btn.disabled = true;
    $('.btn-label', btn).textContent = 'Computing in C…';
    const started = performance.now();
    try {
      await engineReady;
      const data = window.FloydEngine.solve(state.names, state.cost);
      const wait = 450 - (performance.now() - started);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));

      state.result = normalize(data);
      state.visBuilt = state.routeBuilt = false;
      state.ev = 0;
      updateTabs();
      toast(data.negCycle
        ? 'Done. Negative cycle detected; some costs are undefined.'
        : `Done. ${data.stats.updates} routes improved across ${data.n} stages.`,
        data.negCycle ? 'warn' : 'ok');
      switchView('visualize');
      setTimeout(() => { if (state.view === 'visualize' && state.ev === 0) play(); }, 900);
    } catch (err) {
      toast(esc(err.message || 'C engine error'), 'error');
    } finally {
      btn.classList.remove('is-loading');
      $('.btn-label', btn).textContent = 'Run Floyd–Warshall';
      renderSummary();
    }
  }

  /* ======================================================================
     VISUALIZE
     ====================================================================== */
  function buildEvents() {
    const R = state.result, ev = [{ t: 'init' }];
    state.stageEv = [];
    R.stages.forEach((s, k) => {
      state.stageEv[k] = ev.length;
      ev.push({ t: 'stage', k });
      s.updates.forEach((u, idx) => ev.push({ t: 'upd', k, idx, i: u[0], j: u[1], old: u[2], nv: u[3] }));
    });
    ev.push({ t: 'done' });
    state.events = ev;
  }

  /* Matrix after applying the first `upto` updates of stage k. */
  function matrixAfter(k, upto) {
    const R = state.result;
    const m = clone(k === 0 ? R.initial : R.stages[k - 1].dist);
    const ups = R.stages[k].updates;
    for (let u = 0; u < upto; u++) m[ups[u][0]][ups[u][1]] = ups[u][3];
    return m;
  }

  function buildVisualize() {
    const R = state.result, n = R.n;
    buildEvents();

    $('#stageStrip').innerHTML =
      `<button class="stage" data-ev="0"><span class="s-k">D(0)</span><span class="s-name">Direct roads</span><span class="s-upd">start</span></button>` +
      R.stages.map((s, k) =>
        `<button class="stage" data-ev="${state.stageEv[k]}"><span class="s-k">k = ${k + 1}</span>` +
        `<span class="s-name">via ${esc(R.names[k])}</span><span class="s-upd">${s.updates.length} improved</span></button>`).join('') +
      `<button class="stage" data-ev="${state.events.length - 1}"><span class="s-k">D(${n})</span><span class="s-name">Final</span><span class="s-upd">${R.stats.updates} total</span></button>`;

    const t = $('#visTable');
    t.innerHTML =
      `<thead><tr><th>From \\ To</th>${R.names.map((nm, j) => `<th title="${esc(nm)}"><span class="th-idx">${j + 1}</span>${esc(short(nm, 10))}</th>`).join('')}</tr></thead>` +
      `<tbody>${R.names.map((nm, i) => `<tr><th title="${esc(nm)}"><span class="th-idx">${i + 1}</span>${esc(short(nm, 12))}</th>` +
        R.names.map(() => '<td><div class="cell"></div></td>').join('') + '</tr>').join('')}</tbody>`;
    const rows = $$('tbody tr', t);
    state.visCells = rows.map(r => $$('td', r));
    state.visRowTh = rows.map(r => $('th', r));
    state.visColTh = $$('thead th', t).slice(1);

    const scrub = $('#scrub');
    scrub.max = state.events.length - 1;
    state.visBuilt = true;
  }

  function setEvent(e, animate = true) {
    const R = state.result, n = R.n;
    e = clamp(e, 0, state.events.length - 1);
    state.ev = e;
    const ev = state.events[e];
    const k = ev.k ?? -1;

    // scrubber & strip
    const scrub = $('#scrub');
    scrub.value = e;
    scrub.style.setProperty('--pct', (state.events.length > 1 ? (e / (state.events.length - 1)) * 100 : 0) + '%');
    $('#scrubLabel').textContent = `Step ${e} of ${state.events.length - 1}`;
    const activeIdx = ev.t === 'init' ? 0 : ev.t === 'done' ? n + 1 : k + 1;
    $$('#stageStrip .stage').forEach((b, idx) => {
      b.classList.toggle('active', idx === activeIdx);
      b.classList.toggle('done', idx < activeIdx || (ev.t === 'done' && idx <= activeIdx));
    });
    const activeChip = $$('#stageStrip .stage')[activeIdx];
    if (activeChip) {
      const strip = $('#stageStrip');
      const left = activeChip.offsetLeft - strip.clientWidth / 2 + activeChip.clientWidth / 2;
      strip.scrollTo({ left, behavior: reduceMotion ? 'auto' : 'smooth' });
    }

    // matrix state
    let m, upto = 0, before = null;
    if (ev.t === 'init') m = clone(R.initial);
    else if (ev.t === 'done') m = clone(R.dist);
    else {
      upto = ev.t === 'upd' ? ev.idx + 1 : 0;
      m = matrixAfter(k, upto);
      if (ev.t === 'upd') before = matrixAfter(k, ev.idx);
    }
    const changed = new Set();
    if (k >= 0 && ev.t !== 'done') R.stages[k].updates.slice(0, upto).forEach(u => changed.add(u[0] * n + u[1]));

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const td = state.visCells[i][j], v = m[i][j];
        const cell = td.firstChild;
        const cls = ['cell', v === Infinity ? 'v-inf' : v === -Infinity ? 'v-ninf' : v < 0 ? 'v-neg' : ''];
        const tdc = [];
        if (i === j) tdc.push('diag');
        if (k >= 0 && ev.t !== 'done') { if (i === k) tdc.push('row-k'); if (j === k) tdc.push('col-k'); }
        if (changed.has(i * n + j)) tdc.push('changed');
        if (ev.t === 'upd' && ((i === ev.i && j === k) || (i === k && j === ev.j))) tdc.push('witness');
        const isTarget = ev.t === 'upd' && i === ev.i && j === ev.j;
        if (isTarget) tdc.push('target');
        td.className = tdc.join(' ');
        cell.className = cls.join(' ');
        cell.innerHTML = isTarget ? `${fmt(v)}<span class="old">${fmt(ev.old)}</span>` : fmt(v);
        if (isTarget && animate) { td.classList.remove('flash'); void td.offsetWidth; td.classList.add('flash'); }
      }
    }
    state.visRowTh.forEach((th, i) => th.classList.toggle('hl-k', i === k && ev.t !== 'done'));
    state.visColTh.forEach((th, j) => th.classList.toggle('hl-k', j === k && ev.t !== 'done'));

    // titles & counter
    const counter = $('#updCounter');
    if (ev.t === 'init') {
      $('#visTitle').textContent = 'Initial matrix';
      $('#matTitle').innerHTML = 'D<sup>(0)</sup>';
      counter.className = 'pill'; counter.textContent = 'direct roads only';
    } else if (ev.t === 'done') {
      $('#visTitle').textContent = 'All stages complete';
      $('#matTitle').innerHTML = `D<sup>(${n})</sup> · final`;
      counter.className = R.negCycle ? 'pill coral' : 'pill teal';
      counter.textContent = R.negCycle ? 'negative cycle' : `${R.stats.updates} improvements`;
    } else {
      $('#visTitle').textContent = `Stage ${k + 1} · via ${R.names[k]}`;
      $('#matTitle').innerHTML = `D<sup>(${k + 1})</sup>`;
      counter.className = 'pill violet';
      counter.textContent = `${upto} / ${R.stages[k].updates.length} improved`;
    }

    renderNarration(ev, before);
    renderLog(ev, upto);
    renderVisGraph();
  }

  function renderNarration(ev, before) {
    const R = state.result, n = R.n, N = i => esc(R.names[i]);
    const box = $('#narration');
    let html;
    if (ev.t === 'init') {
      html = `<div class="n-step">Initialisation · D(0)</div>
        <div class="n-text">D(0) is the direct-road cost matrix. Pairs without a direct road start at <span class="amber">∞</span> and every city costs 0 to reach itself.</div>
        <div class="n-formula">${R.stats.edges} direct roads · ${n} stages to run · Θ(n³) = ${R.stats.cubic} checks at most</div>`;
    } else if (ev.t === 'stage') {
      const k = ev.k, c = R.stages[k].updates.length;
      html = `<div class="n-step">Stage ${k + 1} of ${n}</div>
        <div class="n-text">Now <span class="violet"><b>${N(k)}</b></span> may be used as a stop between any two cities. Every pair checks whether going through it is cheaper. ${c ? `<span class="teal">${c} ${c === 1 ? 'route improves' : 'routes improve'}</span> in this stage.` : 'No route improves in this stage.'}</div>
        <div class="n-formula">D[i][j] = min( D[i][j] , D[i][<span class="violet">${N(k)}</span>] + D[<span class="violet">${N(k)}</span>][j] )</div>`;
    } else if (ev.t === 'upd') {
      const { i, j, k, old, nv } = ev;
      const a = before[i][k], b = before[k][j];
      html = `<div class="n-step">Stage ${k + 1} · improvement ${ev.idx + 1} of ${R.stages[k].updates.length}</div>
        <div class="n-text"><span class="amber"><b>${N(i)}</b></span> → <span class="amber"><b>${N(j)}</b></span> gets cheaper by travelling via <span class="violet"><b>${N(k)}</b></span>.</div>
        <div class="n-formula">D[${N(i)}][${N(j)}] = min( ${fmt(old)} , <span class="amber">${fmt(a)}</span> + <span class="amber">${fmt(b)}</span> ) = <b class="teal">${fmt(nv)}</b></div>`;
    } else {
      const bad = R.diag.map((v, i) => (v < 0 ? i : -1)).filter(i => i >= 0);
      html = `<div class="n-step">Complete · D(${n})</div>
        <div class="n-text">All ${n} stages are finished. Each cell now holds the cheapest travel cost between two cities, with any city allowed as a stop.</div>` +
        (R.negCycle
          ? `<div class="n-formula"><span class="coral"><b>Negative cycle:</b> D[i][i] &lt; 0 for ${bad.map(N).join(', ')}</span></div>`
          : `<div class="n-formula"><span class="teal">No negative diagonal entries, so every finite cost is valid.</span></div>`);
    }
    box.innerHTML = html;
    box.classList.remove('anim'); void box.offsetWidth; box.classList.add('anim');
  }

  function renderLog(ev, upto) {
    const R = state.result, log = $('#eventLog');
    if (ev.t === 'init' || ev.t === 'done') {
      log.innerHTML = `<li class="empty">${ev.t === 'init' ? 'Press play to start the first stage' : 'Finished. Open the Route planner to query any trip.'}</li>`;
      return;
    }
    const ups = R.stages[ev.k].updates.slice(0, upto);
    if (!ups.length) { log.innerHTML = '<li class="empty">No improvements yet in this stage</li>'; return; }
    log.innerHTML = ups.slice(-60).reverse().map((u, idx) =>
      `<li class="${idx === 0 && ev.t === 'upd' ? 'new' : ''}"><span>${esc(R.names[u[0]])} → ${esc(R.names[u[1]])}</span>` +
      `<span class="lv">${fmt(u[2])} → <b>${fmt(u[3])}</b></span></li>`).join('');
  }

  function renderVisGraph() {
    const R = state.result, svg = $('#visGraph');
    const ev = state.events[state.ev];
    const k = ev.t === 'stage' || ev.t === 'upd' ? ev.k : -1;
    renderGraph(svg, {
      names: R.names, cost: R.cost,
      nodeClass: i => {
        const c = [];
        if (i === k) c.push('is-k');
        if (ev.t === 'upd' && (i === ev.i || i === ev.j) && i !== k) c.push(i === ev.i ? 'is-i' : 'is-j');
        return c.join(' ');
      },
      edgeClass: (i, j) => (ev.t === 'upd' || (k >= 0 && i !== k && j !== k) ? 'dim' : ''),
      overlayTop: P => {
        if (ev.t !== 'upd') return '';
        const id = svg.id;
        const { i, j } = ev;
        const before = matrixAfter(k, ev.idx);
        let out = '';
        const arc = (a, b, bend, cls, mk, val, lab) => {
          if (a === b) return;
          const g = geom(P[a], P[b], bend);
          out += `<path class="${cls}" d="${g.d}" marker-end="url(#${id}-${mk})"/>`;
          out += label(g.mx, g.my, fmt(val), 'lab ' + lab);
        };
        if (i === j) {
          arc(i, k, 28, 'arc-ik', 'amber', before[i][k], 'amber');
          arc(k, j, 28, 'arc-kj', 'amber', before[k][j], 'amber');
          out += label(P[i].x, P[i].y - 42, fmt(ev.nv), 'lab teal');
        } else {
          arc(i, k, 0, 'arc-ik', 'amber', before[i][k], 'amber');
          arc(k, j, 0, 'arc-kj', 'amber', before[k][j], 'amber');
          const dx = P[j].x - P[i].x, dy = P[j].y - P[i].y;
          const side = Math.sign(dx * (P[k].y - P[i].y) - dy * (P[k].x - P[i].x)) || 1;
          arc(i, j, -side * 60, 'arc-ij', 'teal', ev.nv, 'teal');
        }
        return out;
      },
    });
    svg._render = renderVisGraph;
  }

  /* ------------------------------- playback ------------------------------ */
  function nextIndex(dir) {
    const e = state.ev, last = state.events.length - 1;
    if (state.mode === 'update') return clamp(e + dir, 0, last);
    let x = e + dir;
    while (x > 0 && x < last && state.events[x].t !== 'stage') x += dir;
    return clamp(x, 0, last);
  }

  function step(dir) { setEvent(nextIndex(dir)); }

  function play() {
    if (!state.result) return;
    if (state.ev >= state.events.length - 1) setEvent(0);
    state.playing = true;
    $('.play-btn').classList.add('is-playing');
    $('.play-btn').setAttribute('aria-label', 'Pause');
    tick();
  }

  function tick() {
    clearTimeout(state.timer);
    if (!state.playing) return;
    const ev = state.events[state.ev];
    const base = state.mode === 'stage' ? 1700 : ev.t === 'upd' ? 1050 : 1500;
    state.timer = setTimeout(() => {
      if (state.ev >= state.events.length - 1) return pause();
      step(1);
      if (state.ev >= state.events.length - 1) pause();
      else tick();
    }, base / state.speed);
  }

  function pause() {
    state.playing = false;
    clearTimeout(state.timer);
    const b = $('.play-btn');
    if (b) { b.classList.remove('is-playing'); b.setAttribute('aria-label', 'Play'); }
  }

  function bindPlayer() {
    $('#player').addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b || !state.result) return;
      const act = b.dataset.act;
      if (act === 'play') return state.playing ? pause() : play();
      pause();
      if (act === 'first') setEvent(0);
      else if (act === 'last') setEvent(state.events.length - 1);
      else step(act === 'next' ? 1 : -1);
    });
    $('#scrub').addEventListener('input', e => { pause(); setEvent(+e.target.value, false); });
    $('#stageStrip').addEventListener('click', e => {
      const b = e.target.closest('[data-ev]');
      if (b) { pause(); setEvent(+b.dataset.ev); }
    });
    $('#stepMode').addEventListener('click', e => {
      const b = e.target.closest('[data-mode]');
      if (!b) return;
      state.mode = b.dataset.mode;
      $$('#stepMode button').forEach(x => x.classList.toggle('is-on', x === b));
      if (state.playing) tick();
    });
    $('#speedSeg').addEventListener('click', e => {
      const b = e.target.closest('[data-speed]');
      if (!b) return;
      state.speed = +b.dataset.speed;
      $$('#speedSeg button').forEach(x => x.classList.toggle('is-on', x === b));
      if (state.playing) tick();
    });
    document.addEventListener('keydown', e => {
      if (state.view !== 'visualize' || !state.result) return;
      if (e.target.closest('input, select, textarea, button')) return;
      if (e.key === ' ') { e.preventDefault(); state.playing ? pause() : play(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); pause(); step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); pause(); step(-1); }
    });
  }

  /* ======================================================================
     ROUTE PLANNER
     ====================================================================== */
  function routePath(s, d) {
    const R = state.result, path = [s];
    let cur = s;
    while (cur !== d) {
      cur = R.next[cur][d];
      if (cur < 0 || path.length > R.n) return null;
      path.push(cur);
    }
    return path;
  }

  function buildRoutes() {
    const R = state.result, n = R.n;
    const opts = R.names.map((nm, i) => `<option value="${i}">${i + 1} · ${esc(nm)}</option>`).join('');
    $('#srcSel').innerHTML = opts;
    $('#dstSel').innerHTML = opts;

    // start with the most interesting pair: the finite route with the most stops
    let best = [0, n > 1 ? 1 : 0, -1];
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        if (i === j || R.affected[i][j] || R.dist[i][j] === Infinity) continue;
        const p = routePath(i, j);
        if (p && p.length > best[2]) best = [i, j, p.length];
      }
    state.src = best[0];
    state.dst = best[1];

    // heatmap
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const v = R.dist[i][j];
        if (i !== j && isFinite(v) && !R.affected[i][j]) { min = Math.min(min, v); max = Math.max(max, v); }
      }
    const t = $('#finalTable');
    t.innerHTML =
      `<thead><tr><th>From \\ To</th>${R.names.map((nm, j) => `<th title="${esc(nm)}"><span class="th-idx">${j + 1}</span>${esc(short(nm, 10))}</th>`).join('')}</tr></thead><tbody>` +
      R.names.map((nm, i) => `<tr><th title="${esc(nm)}"><span class="th-idx">${i + 1}</span>${esc(short(nm, 12))}</th>` +
        R.names.map((_, j) => {
          const v = R.dist[i][j];
          if (R.affected[i][j]) return `<td data-i="${i}" data-j="${j}"><div class="cell ninf-cell v-ninf">−∞</div></td>`;
          if (v === Infinity) return `<td data-i="${i}" data-j="${j}"><div class="cell inf-cell v-inf">∞</div></td>`;
          if (i === j) return `<td class="diag" data-i="${i}" data-j="${j}"><div class="cell">0</div></td>`;
          const p = Math.round(((v - min) / (max - min || 1)) * 100);
          return `<td data-i="${i}" data-j="${j}"><div class="cell ${v < 0 ? 'v-neg' : ''}" style="background:color-mix(in oklab, color-mix(in oklab, var(--teal), var(--amber) ${p}%) 30%, transparent)">${fmt(v)}</div></td>`;
        }).join('') + '</tr>').join('') + '</tbody>';
    state.routeBuilt = true;
  }

  function countUp(el, to, dur = 900) {
    if (!isFinite(to) || reduceMotion) { el.textContent = fmt(to); return; }
    const start = performance.now();
    const stepFn = now => {
      const p = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(Math.round(to * e));
      if (p < 1) requestAnimationFrame(stepFn);
    };
    requestAnimationFrame(stepFn);
  }

  const ICON_WARN = '<svg viewBox="0 0 24 24"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/></svg>';
  const ICON_OK = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.6 2.6L16 9.5"/></svg>';
  const ICON_INFO = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>';

  /* Explains an unreachable pair: roads are one-way, so check in/out edges. */
  function unreachableReason(s, d) {
    const R = state.result, n = R.n, N = i => esc(R.names[i]);
    let inD = 0, outS = 0;
    for (let i = 0; i < n; i++) {
      if (i !== d && isFinite(R.cost[i][d])) inD++;
      if (i !== s && isFinite(R.cost[s][i])) outS++;
    }
    const base = `No sequence of roads leads from <b>${N(s)}</b> to <b>${N(d)}</b>. Roads are one-way (row → column in the cost matrix).`;
    if (!outS) return `${base} <b>${N(s)}</b> has no outgoing road, so it cannot reach any other city.`;
    if (!inD) return `${base} <b>${N(d)}</b> has no incoming road, so no city can reach it.`;
    return `${base} None of the cities reachable from <b>${N(s)}</b> has a road into <b>${N(d)}</b>.`;
  }

  function renderRoute() {
    const R = state.result, s = state.src, d = state.dst, N = i => esc(R.names[i]);
    $('#srcSel').value = s;
    $('#dstSel').value = d;
    const box = $('#routeResult');
    let path = null, html;

    if (R.affected[s][d]) {
      html = `<div class="res-top"><div><div class="res-label">Cheapest cost</div><div class="res-cost coral">−∞</div></div><span class="pill coral">Undefined</span></div>
        <div class="notice coral">${ICON_WARN}<div>Any route from <b>${N(s)}</b> to <b>${N(d)}</b> can loop through a negative cycle and get cheaper every time, so no cheapest route exists.</div></div>`;
    } else if (R.dist[s][d] === Infinity) {
      html = `<div class="res-top"><div><div class="res-label">Cheapest cost</div><div class="res-cost dim">∞</div></div><span class="pill amber">Unreachable</span></div>
        <div class="notice amber">${ICON_INFO}<div>${unreachableReason(s, d)}</div></div>`;
    } else if (s === d) {
      html = `<div class="res-top"><div><div class="res-label">Cheapest cost</div><div class="res-cost teal">0</div></div><span class="pill violet">Same city</span></div>
        <div class="notice">${ICON_INFO}<div>Source and destination are both <b>${N(s)}</b>. Pick a different destination.</div></div>`;
    } else {
      path = routePath(s, d);
      const cost = R.dist[s][d], direct = R.cost[s][d];
      const saved = isFinite(direct) && direct > cost ? direct - cost : null;
      let total = 0;
      const tl = path.map((c, h) => {
        let leg = '';
        if (h < path.length - 1) {
          const w = R.cost[c][path[h + 1]];
          total += w;
          leg = `<div class="t-leg ${w < 0 ? 'neg' : ''}">road cost <b>${fmt(w)}</b> · running total ${fmt(total)}</div>`;
        }
        return `<li style="animation-delay:${200 + h * 110}ms"><span class="t-dot">${c + 1}</span><div class="t-city">${N(c)}</div>${leg}</li>`;
      }).join('');
      html = `<div class="res-top"><div><div class="res-label">Cheapest cost</div><div class="res-cost teal" data-to="${cost}">0</div></div><span class="pill teal">Optimal</span></div>
        <div class="res-sub">${N(s)} → ${N(d)} · ${path.length - 1} ${path.length === 2 ? 'road' : 'roads'}</div>
        <div class="res-compare">
          <div><span>Direct road</span><b>${isFinite(direct) ? fmt(direct) : 'None'}</b></div>
          <div><span>Stops between</span><b>${path.length - 2}</b></div>
          <div><span>Saved vs direct</span><b class="${saved ? 'teal' : ''}">${saved ? fmt(saved) + ' (' + Math.round((saved / direct) * 100) + '%)' : '—'}</b></div>
        </div>
        <ol class="timeline">${tl}</ol>`;
    }
    box.innerHTML = html;
    const costEl = $('.res-cost[data-to]', box);
    if (costEl) countUp(costEl, +costEl.dataset.to);

    $$('#finalTable td').forEach(td => td.classList.toggle('sel', +td.dataset.i === s && +td.dataset.j === d));
    state.routePath = path;
    renderRouteGraph();
  }

  function renderRouteGraph() {
    const R = state.result, svg = $('#routeGraph');
    const s = state.src, d = state.dst, path = state.routePath;
    const onPath = new Set(path || []);
    const legs = new Set();
    if (path) for (let h = 0; h < path.length - 1; h++) legs.add(path[h] + '-' + path[h + 1]);

    renderGraph(svg, {
      names: R.names, cost: R.cost,
      nodeClass: i => (i === s ? 'is-src' : i === d ? 'is-dst' : path ? (onPath.has(i) ? 'on-route' : 'dim') : ''),
      edgeClass: (i, j) => (path ? (legs.has(i + '-' + j) ? 'on-route' : 'dim') : ''),
      overlay: P => {
        if (!path) return '';
        let out = '';
        for (let h = 0; h < path.length - 1; h++) {
          const a = path[h], b = path[h + 1];
          out += `<path class="route-flow" d="${geom(P[a], P[b], noEdge(R.cost[b][a]) ? 0 : 24).d}"/>`;
        }
        return out;
      },
      overlayTop: () => (path ? '<circle class="car" r="6.5" cx="-20" cy="-20"/>' : ''),
    });
    svg._render = renderRouteGraph;
    startCar(svg);
  }

  function startCar(svg) {
    cancelAnimationFrame(state.carRaf);
    const legs = $$('.route-flow', svg), car = $('.car', svg);
    if (!legs.length || !car) return;
    const lens = legs.map(p => p.getTotalLength());
    const total = lens.reduce((a, b) => a + b, 0);
    const travel = Math.max(1400, total * 7), hold = 700;
    const t0 = performance.now();
    const frame = now => {
      const t = (now - t0) % (travel + hold);
      let dist = Math.min(1, t / travel);
      dist = (dist < 0.5 ? 2 * dist * dist : 1 - Math.pow(-2 * dist + 2, 2) / 2) * total;
      let h = 0;
      while (h < lens.length - 1 && dist > lens[h]) { dist -= lens[h]; h++; }
      const pt = legs[h].getPointAtLength(Math.min(dist, lens[h]));
      car.setAttribute('cx', pt.x);
      car.setAttribute('cy', pt.y);
      if (!reduceMotion) state.carRaf = requestAnimationFrame(frame);
    };
    state.carRaf = requestAnimationFrame(frame);
  }

  function bindRoutes() {
    $('#srcSel').addEventListener('change', e => { state.src = +e.target.value; renderRoute(); });
    $('#dstSel').addEventListener('change', e => { state.dst = +e.target.value; renderRoute(); });
    $('#swapBtn').addEventListener('click', e => {
      const b = e.currentTarget;
      b.classList.toggle('spin');
      [state.src, state.dst] = [state.dst, state.src];
      renderRoute();
    });

    const t = $('#finalTable');
    t.addEventListener('click', e => {
      const td = e.target.closest('td[data-i]');
      if (!td) return;
      state.src = +td.dataset.i;
      state.dst = +td.dataset.j;
      renderRoute();
      $('.query-card').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    });
    t.addEventListener('mouseover', e => {
      const td = e.target.closest('td[data-i]');
      if (!td) return;
      const i = +td.dataset.i, j = +td.dataset.j;
      $$('.cross', t).forEach(x => x.classList.remove('cross'));
      $$(`td[data-i="${i}"], td[data-j="${j}"]`, t).forEach(x => x.classList.add('cross'));
      const rows = $$('tbody th', t), cols = $$('thead th', t).slice(1);
      if (rows[i]) rows[i].classList.add('cross');
      if (cols[j]) cols[j].classList.add('cross');
    });
    t.addEventListener('mouseleave', () => $$('.cross', t).forEach(x => x.classList.remove('cross')));
  }

  /* ======================================================================
     INSIGHTS
     ====================================================================== */
  function renderInsights() {
    const R = state.result, n = R.n, N = i => esc(R.names[i]);
    const cyc = R.diag.map((v, i) => (v < 0 ? i : -1)).filter(i => i >= 0);
    const tiles = [
      { label: 'Cities', v: n, accent: 'var(--amber)', foot: 'vertices in the graph' },
      { label: 'Direct roads', v: R.stats.edges, accent: 'var(--blue)', foot: `${R.stats.negEdges} with negative cost` },
      { label: 'Relaxation checks', v: R.stats.relaxTests, accent: 'var(--violet)', foot: `upper bound n³ = ${R.stats.cubic}` },
      { label: 'Improvements', v: R.stats.updates, accent: 'var(--teal)', foot: 'cells made cheaper' },
      { label: 'Unreachable pairs', v: R.unreach, accent: 'var(--muted)', foot: `of ${n * (n - 1)} ordered pairs` },
      { label: 'Negative cycle', text: R.negCycle ? 'Yes' : 'No', accent: R.negCycle ? 'var(--coral)' : 'var(--green)', foot: R.negCycle ? `${cyc.length} cities on a cycle` : 'all costs are finite' },
    ];
    $('#statTiles').innerHTML = tiles.map((t, i) =>
      `<div class="stat" style="--accent:${t.accent};animation-delay:${i * 70}ms"><div class="s-label">${t.label}</div>` +
      `<div class="s-val" ${t.text ? '' : `data-to="${t.v}"`}>${t.text || 0}</div><div class="s-foot">${t.foot}</div></div>`).join('');
    $$('#statTiles [data-to]').forEach((el, i) => setTimeout(() => countUp(el, +el.dataset.to, 1000), i * 70));

    const counts = R.stages.map(s => s.updates.length), mx = Math.max(1, ...counts);
    $('#stageBars').innerHTML = counts.map((c, k) =>
      `<div class="bar-row"><span class="b-name" title="${N(k)}"><i>k=${k + 1}</i>${N(k)}</span>` +
      `<div class="bar-track"><div class="bar-fill" data-w="${(c / mx) * 100}" style="transition-delay:${k * 60}ms"></div></div>` +
      `<span class="b-val">${c}</span></div>`).join('');
    requestAnimationFrame(() => requestAnimationFrame(() =>
      $$('#stageBars .bar-fill').forEach(b => { b.style.width = b.dataset.w + '%'; })));

    const chips = R.diag.map((v, i) =>
      `<span class="diag-chip ${v < 0 ? 'bad' : ''}" style="animation-delay:${i * 40}ms">${N(i)}<b>${fmt(v)}</b></span>`).join('');
    if (!R.negCycle) {
      $('#cycleReport').innerHTML = `<div class="diag-chips">${chips}</div>
        <div class="notice green">${ICON_OK}<div>Every diagonal entry is 0, so there is <b>no negative cycle</b> and all finite costs are valid shortest costs.</div></div>`;
    } else {
      const pairs = [];
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++)
          if (R.affected[i][j]) pairs.push(`<span class="pair">${N(i)}<span class="arr">→</span>${N(j)}</span>`);
      $('#cycleReport').innerHTML = `<div class="diag-chips">${chips}</div>
        <div class="notice coral">${ICON_WARN}<div><b>Negative cycle detected</b> through ${cyc.map(N).join(', ')}. ${pairs.length} pairs have no cheapest cost (−∞):</div></div>
        <div class="pair-list">${pairs.join('')}</div>`;
    }

    const un = [];
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        if (i !== j && R.dist[i][j] === Infinity) un.push(`<span class="pair">${N(i)}<span class="arr">→</span>${N(j)}</span>`);
    $('#unreachList').innerHTML = un.length
      ? `<div class="notice">${ICON_INFO}<div><b>${un.length}</b> of ${n * (n - 1)} ordered pairs cannot be reached by any sequence of roads.</div></div><div class="pair-list">${un.join('')}</div>`
      : `<div class="notice green">${ICON_OK}<div>Every city can reach every other city.</div></div>`;

    $('#nextTable').innerHTML =
      `<thead><tr><th>From \\ To</th>${R.names.map((nm, j) => `<th title="${esc(nm)}"><span class="th-idx">${j + 1}</span>${esc(short(nm, 10))}</th>`).join('')}</tr></thead><tbody>` +
      R.names.map((nm, i) => `<tr><th title="${esc(nm)}"><span class="th-idx">${i + 1}</span>${esc(short(nm, 12))}</th>` +
        R.next[i].map((x, j) => {
          if (i === j) return '<td class="diag"><div class="cell">—</div></td>';
          if (x < 0) return '<td><div class="cell v-inf">–</div></td>';
          return `<td><div class="cell" title="${N(x)}"><span><span class="th-idx">${x + 1}</span>${esc(short(R.names[x], 9))}</span></div></td>`;
        }).join('') + '</tr>').join('') + '</tbody>';
  }

  /* ======================================================================
     SHELL: tabs, theme, engine status
     ====================================================================== */
  function moveIndicator() {
    const tab = $('.tab.is-active'), ind = $('.tab-indicator');
    if (!tab) return;
    ind.style.width = tab.offsetWidth + 'px';
    ind.style.transform = `translateX(${tab.offsetLeft}px)`;
  }

  function updateTabs() {
    $$('.tab').forEach(t => {
      const locked = t.dataset.view !== 'network' && !state.result;
      t.classList.toggle('is-locked', locked);
      t.title = locked ? 'Run Floyd–Warshall first' : '';
    });
    if (!state.result && state.view !== 'network') switchView('network');
  }

  function switchView(v) {
    if (v !== 'network' && !state.result) {
      toast('Run Floyd–Warshall first to unlock this section.', 'warn');
      const b = $('#runBtn');
      b.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 450, easing: 'ease-out' });
      return;
    }
    if (v !== 'visualize') pause();
    if (v !== 'routes') cancelAnimationFrame(state.carRaf);
    state.view = v;
    $$('.tab').forEach(t => {
      const on = t.dataset.view === v;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on);
    });
    moveIndicator();
    $$('.view').forEach(sec => {
      const on = sec.dataset.view === v;
      sec.hidden = !on;
      sec.classList.remove('is-entering');
      if (on) { void sec.offsetWidth; sec.classList.add('is-entering'); }
    });
    window.scrollTo({ top: 0, behavior: 'auto' });

    if (v === 'visualize') { if (!state.visBuilt) buildVisualize(); setEvent(state.ev); }
    else if (v === 'routes') { if (!state.routeBuilt) buildRoutes(); renderRoute(); }
    else if (v === 'insights') renderInsights();
    else renderNetGraph(false);
  }

  function setEngine(ok) {
    const b = $('#engineBadge');
    b.classList.toggle('is-online', ok);
    b.classList.toggle('is-offline', !ok);
    $('.engine-text', b).textContent = ok ? 'C engine · WebAssembly' : 'Engine unavailable';
  }

  let engineReady = null;
  function loadEngine() {
    engineReady = window.FloydEngine.load('floyd.wasm')
      .then(() => setEngine(true))
      .catch(err => {
        setEngine(false);
        const fileUrl = location.protocol === 'file:';
        toast(fileUrl
          ? 'Open FareGrid through a web server (e.g. <b>python3 -m http.server</b> in public/), not as a file.'
          : 'The C engine (floyd.wasm) could not be loaded.', 'error');
        throw err;
      });
    engineReady.catch(() => {});
  }

  function bindShell() {
    $('#homeLink').addEventListener('click', e => {
      e.preventDefault();
      switchView('network');
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    });
    $('.tabs').addEventListener('click', e => {
      const t = e.target.closest('.tab');
      if (t) switchView(t.dataset.view);
    });
    $('#themeToggle').addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('fw-theme', next); } catch (e) { /* ignore */ }
    });
    window.addEventListener('resize', moveIndicator);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveIndicator);
  }

  /* --------------------------------- init -------------------------------- */
  function init() {
    const saved = loadSaved();
    if (saved) {
      state.names = saved.names;
      state.cost = saved.cost;
      state.pos = saved.pos || {};
      state.preset = saved.preset || null;
      const p = PRESETS.find(x => x.id === state.preset);
      if (p) Object.assign(state, presetData(p));
    } else {
      const d = presetData(PRESETS[0]);
      state.names = d.names;
      state.cost = d.cost;
      state.preset = PRESETS[0].id;
    }
    bindShell();
    bindNetwork();
    bindPlayer();
    bindRoutes();
    ['#netGraph', '#visGraph', '#routeGraph'].forEach(s => enableDrag($(s)));
    renderNetwork(true);
    updateTabs();
    moveIndicator();
    loadEngine();
  }

  init();
})();
