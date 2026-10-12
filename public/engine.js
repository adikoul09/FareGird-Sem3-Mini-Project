/* ==========================================================================
   FareGrid — bridge to the C engine (engine/floyd_core.c → floyd.wasm)
   Writes the cost matrix into WebAssembly memory, calls fw_solve() and reads
   back the full trace. INF is returned as null and −∞ as "-inf".
   ========================================================================== */
(function (root) {
  'use strict';

  let ex = null;

  async function load(source) {
    if (ex) return true;
    let instance;
    if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
      instance = (await WebAssembly.instantiate(source, {})).instance;
    } else {
      const url = source || 'floyd.wasm';
      try {
        instance = (await WebAssembly.instantiateStreaming(fetch(url), {})).instance;
      } catch (e) {
        // Fallback when the server does not send application/wasm
        const buf = await (await fetch(url)).arrayBuffer();
        instance = (await WebAssembly.instantiate(buf, {})).instance;
      }
    }
    ex = instance.exports;
    return true;
  }

  /* names: string[], cost: (number|null)[][]  →  trace object */
  function solve(names, cost) {
    if (!ex) throw new Error('C engine is not loaded.');
    const n = names.length, MAX = ex.fw_max(), INF = ex.fw_inf();
    if (n < 1 || n > MAX) throw new Error(`Provide between 1 and ${MAX} cities.`);

    let H = new Int32Array(ex.memory.buffer);
    const cp = ex.fw_cost() >> 2;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        H[cp + i * MAX + j] = cost[i][j] === null ? INF : cost[i][j];

    const rc = ex.fw_solve(n);
    if (rc === -1) throw new Error(`Provide between 1 and ${MAX} cities.`);
    if (rc === -2) throw new Error('Costs must be integers within ±1,000,000.');

    H = new Int32Array(ex.memory.buffer);
    const val = v => (v >= INF ? null : v <= -INF ? '-inf' : v);
    const grid = (base, f) => Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => f(H[base + i * MAX + j])));

    const up = ex.fw_upd() >> 2, us = ex.fw_upd_start() >> 2, uc = ex.fw_upd_count() >> 2;
    const sp = ex.fw_snap() >> 2, st = ex.fw_stats() >> 2;
    const stages = [];
    for (let k = 0; k < n; k++) {
      const updates = [];
      for (let u = 0; u < H[uc + k]; u++) {
        const o = up + (H[us + k] + u) * 4;
        updates.push([H[o], H[o + 1], val(H[o + 2]), val(H[o + 3])]);
      }
      stages.push({ k, updates, dist: grid(sp + k * MAX * MAX, val) });
    }

    const dist = grid(ex.fw_dist() >> 2, val);
    return {
      n,
      names: names.slice(),
      cost: grid(cp, val),
      stages,
      dist,
      next: grid(ex.fw_next() >> 2, v => v),
      diag: dist.map((r, i) => r[i]),
      negCycle: H[st + 4] === 1,
      affected: grid(ex.fw_affected() >> 2, v => v),
      stats: {
        relaxTests: H[st], updates: H[st + 1], edges: H[st + 2],
        negEdges: H[st + 3], cubic: n * n * n,
      },
    };
  }

  const api = { load, solve, get loaded() { return !!ex; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FloydEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
