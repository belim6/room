// Floor model: pure functions from (events, actors, time) to what the floor shows. Shared by the page and the tests,
// so replay is deterministic: the same events and the same t always give the same state. Every visible state is bound
// to an explicit event (PSRI rule 2); with no event there is no animation, and idle/unknown are states of their own.

export const PERM = {
  deniz: [0.05, 0.50], coordinator: [0.27, 0.50], critic: [0.27, 0.13], server: [0.55, 0.88], providers: [0.05, 0.88], outside: [0.05, 0.13],
  repo: [0.20, 0.95], transcripts: [0.12, 0.70], archive: [0.88, 0.10], ledger: [0.88, 0.36], vault: [0.88, 0.62], rooms: [0.88, 0.88],
};
export const ARTIFACT = new Set(['archive', 'ledger', 'vault', 'rooms', 'repo', 'outside', 'transcripts']);
export const FAIL = new Set(['error', 'no-go', 'missing', 'gap', 'extraction-failed', 'extraction-failed-repaired', 'stopped', 'blocked', 'no-output']);
export const isFailure = (e) => FAIL.has(e.outcome) || e.verb === 'error' || e.verb === 'deviation' || e.verb === 'block';

const byTs = (a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.seq - b.seq);
const T = (s) => Date.parse(s);

// Compressed clock: idle stretches longer than maxGap collapse to `squash` ms, so a two-hour operation with a
// 40-second labeling burst still replays watchably. Pure and invertible on the event set.
export function timeline(events, { maxGap = 30e3, squash = 3e3, compress = true } = {}) {
  const ts = [...new Set(events.flatMap((e) => (e.until ? [T(e.ts), T(e.until)] : [T(e.ts)])))].sort((a, b) => a - b);
  if (!ts.length) return { start: 0, end: 0, duration: 0, toReal: () => 0, toComp: () => 0, breaks: [] };
  const K = [[ts[0], 0]], breaks = [];
  for (let i = 1; i < ts.length; i++) {
    const gap = ts[i] - ts[i - 1]; if (!compress || gap <= maxGap) continue;
    const [r, c] = K[K.length - 1], c1 = c + (ts[i - 1] - r); K.push([ts[i - 1], c1], [ts[i], c1 + squash]); breaks.push({ at: c1, real: gap });
  }
  const lerp = (x, i, j) => { for (let k = 0; k + 1 < K.length; k++) if (x >= K[k][i] && x <= K[k + 1][i]) return K[k][j] + ((x - K[k][i]) * (K[k + 1][j] - K[k][j])) / Math.max(1, K[k + 1][i] - K[k][i]);
    return x < K[0][i] ? K[0][j] : K[K.length - 1][j] + (x - K[K.length - 1][i]); };
  const end = ts[ts.length - 1], toComp = (t) => lerp(t, 0, 1), toReal = (c) => lerp(c, 1, 0);
  return { start: ts[0], end, duration: toComp(end), toReal, toComp, breaks };
}

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

// Static layout for one operation: permanent nodes fixed, ephemeral actors on rings around their parent (in spawn order),
// files as chips in a column beside their artifact node (in first-touch order).
export function layout(events, actors) {
  const A = new Map(actors.map((a) => [a.id, a])), pos = new Map(Object.entries(PERM)), order = [], seen = new Set();
  const ev = [...events].sort(byTs);
  for (const e of ev) for (const id of [e.actor.id, e.verb === 'spawn' && e.target?.kind === 'actor' ? e.target.id : null])
    if (id && !PERM[id] && !seen.has(id)) { seen.add(id); order.push(id); }
  const kids = new Map();
  for (const id of order) { const a = A.get(id) || { id }, p = a.parent && (PERM[a.parent] || seen.has(a.parent)) ? a.parent : 'coordinator';
    (kids.get(p) || kids.set(p, []).get(p)).push(id); }
  // Bays: the coordinator's and critic's children fill a grid between them and the artifact column; deeper children ring their parent.
  const BAY = { coordinator: [0.36, 0.27, 0.72, 0.84], critic: [0.36, 0.03, 0.72, 0.22] }; let cell = 0.1;
  const place = (p) => { const list = kids.get(p) || [], [px, py] = pos.get(p) || PERM.coordinator, bay = BAY[p];
    if (bay && list.length) { const [x0, y0, x1, y1] = bay, cols = Math.max(1, Math.min(list.length, Math.ceil(Math.sqrt(list.length * 0.9)), 6)), rows = Math.ceil(list.length / cols); cell = Math.min(cell, (x1 - x0) / cols);
      list.forEach((id, i) => pos.set(id, [x0 + ((x1 - x0) * ((i % cols) + 0.5)) / cols, y0 + ((y1 - y0) * (Math.floor(i / cols) + 0.5)) / rows])); }
    else list.forEach((id, i) => { const ring = Math.floor(i / 8), k = i % 8, n = Math.min(8, list.length - ring * 8), r = 0.06 + ring * 0.045, ang = -Math.PI / 2 + (2 * Math.PI * k) / Math.max(n, 1);
      pos.set(id, [Math.min(0.66, Math.max(0.08, px + Math.cos(ang) * r)), Math.min(0.95, Math.max(0.05, py + Math.sin(ang) * r * 1.5))]); });
    for (const id of list) place(id); };
  for (const p of Object.keys(PERM)) place(p);
  const chips = new Map(), perGroup = new Map();
  for (const e of ev) { const t = e.target; if (!t || t.kind !== 'file' || chips.has(t.path)) continue;
    const g = t.group || 'outside', n = perGroup.get(g) || 0; perGroup.set(g, n + 1);
    const [gx, gy] = PERM[g], col = Math.floor(n / 9) % 2, row = n % 9, over = n >= 18 || g === 'repo' || g === 'transcripts';
    const x = g === 'outside' ? 0.01 + col * 0.085 : 0.80 + col * 0.085, y = g === 'rooms' ? gy - 0.04 - row * 0.021 : gy + 0.035 + row * 0.021;
    chips.set(t.path, { group: g, index: n, overflow: over, pos: [x, y] }); }
  return { pos, chips, order, cell };
}

// Where an event's edge starts and ends. read: artifact -> actor; write: actor -> artifact; others: actor -> actor.
export function endpoints(e, L) {
  const at = (id) => L.pos.get(id), file = (t) => { const c = L.chips.get(t.path); return c && !c.overflow ? c.pos : PERM[t.group || 'outside']; };
  const a = at(e.actor.id) || PERM.coordinator, t = e.target;
  let b = !t ? null : t.kind === 'file' ? file(t) : t.kind === 'actor' ? at(t.id) : t.group ? PERM[t.group] : t.kind === 'command' ? null : PERM[t.id] || null;
  if (!b) return null;
  return e.verb === 'read' ? [b, a] : [a, b];
}

// State at event-time t (ms). Pure: depends only on (events, actors, t, opts).
export function stateAt(events, actors, t, { travel = 1500, pulse = 2500 } = {}) {
  const A = new Map(actors.map((a) => [a.id, a])), st = new Map(), edges = [], marks = [];
  const get = (id) => st.get(id) || st.set(id, { id, born: null, ended: null, last: null, lastVerb: null, outcome: null, wait: null, block: null, fails: 0, gaps: 0, lifecycle: false }).get(id);
  for (const e of events) {
    const ts = T(e.ts); if (ts > t) break;
    const s = get(e.actor.id); if (s.born == null) s.born = ts; s.last = ts; s.lastVerb = e.verb;
    if (e.verb === 'spawn' && e.target?.kind === 'actor') { const c = get(e.target.id); c.lifecycle = true; if (c.born == null) c.born = ts; c.spawnTs = ts; }
    if (e.verb === 'end') { s.ended = ts; s.outcome = e.outcome || 'done'; s.lifecycle = true; }
    if (e.verb === 'wait') s.wait = { ts, ev: e.id }; else if (e.verb === 'block') s.block = { ts, ev: e.id, label: e.label }; else if (e.verb === 'unblock') s.block = null;
    else { if (s.wait && ts > s.wait.ts) s.wait = null; if (s.block && ts > s.block.ts && e.verb !== 'deviation' && e.verb !== 'error') s.block = null; }
    if (e.verb === 'deviation') s.gaps++; else if (isFailure(e)) s.fails++;
    if (isFailure(e)) marks.push({ id: e.id, ts, actor: e.actor.id, kind: e.verb === 'deviation' ? 'gap' : 'fail', outcome: e.outcome || e.verb });
    const end = e.until ? Math.max(T(e.until), ts + travel) : ts + travel;
    if (t - ts <= travel || (e.until && t <= T(e.until))) edges.push({ id: e.id, verb: e.verb, p: Math.min(1, (t - ts) / (end - ts)), age: t - ts, provenance: e.provenance, fail: isFailure(e) });
  }
  for (const [id, s] of st) {
    const a = A.get(id) || {};
    s.state = a.permanent ? (s.block ? 'blocked' : s.wait ? 'waiting' : t - s.last <= pulse ? 'active' : 'idle')
      : s.ended != null ? 'ended' : s.block ? 'blocked' : s.wait ? 'waiting' : t - s.last <= pulse ? 'active' : s.lifecycle ? 'open' : 'unknown';
    s.pulse = t - s.last <= pulse ? 1 - (t - s.last) / pulse : 0;
  }
  return { actors: st, edges, marks };
}
