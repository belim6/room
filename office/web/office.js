import { PERM, ARTIFACT, layout, endpoints, stateAt, timeline, isFailure, visibleAt, descendants, narrate, bundleSummary, agentStory } from './model.mjs';
import { liveClient } from './liveclient.mjs';

const $ = (s) => document.querySelector(s);
const h = (tag, attrs = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) if (v != null) k === 'on' ? Object.entries(v).forEach(([e, f]) => n.addEventListener(e, f)) : k === 'class' ? (n.className = v) : n.setAttribute(k, v);
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c instanceof Node ? c : String(c)); return n; };
const get = (u) => fetch(u).then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(Error(j.error || r.status)))));
const KIND = { human: '#e6edf3', coordinator: '#58a6ff', critic: '#c297ff', labeler: '#3fd0c9', engineer: '#56d364', reviewer: '#f0883e', writer: '#d2a8ff', driver: '#8fb3d9', server: '#9aa7b4', provider: '#7d8590', artifact: '#59636e', unknown: '#7d8590' };
const COL = { cap: '#7cc4ff', der: '#b39cff', inf: '#8b949e', ok: '#4fd18b', amber: '#f0b429', red: '#ff5c5c', dim: '#3a434d', fg: '#c9d1d9' };
const fmtT = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
const short = (p = '') => p.replace(/^.*\/coordination\//, '').replace(/^.*\/prompt-knowledge\//, 'pk/').replace(/^.*\/\.room-data\//, 'rd/').replace(/^\/Users\/[^/]+\//, '~/');
const base = (p = '') => p.split('/').pop();
const inOp = (e, op) => !op || op === '*' || e.operation === op || (e.operation || '').startsWith(op + '/');

const S = { summary: null, op: '', events: [], actors: [], A: new Map(), L: null, tl: null, c: 0, playing: false, speed: 10, compress: true, sel: null, hover: null, lastLog: '',
  byId: new Map(), live: false, es: null, focus: true, follow: null, raw: false, cam: { x: 0, y: 0, s: 1 }, opTitle: new Map(), changed: 0 };
globalThis.officeState = S; // for inspection from the console
const nameOf = (id) => { const a = S.A.get(id); return a?.name || a?.label || id; };
const opTitleOf = (id) => S.opTitle.get(id) || id;

async function init() {
  S.loadedAt = Date.now();
  S.summary = await get('/api/summary'); fillOps();
  const sel = $('#op'), ops = S.summary.operations;
  const want = decodeURIComponent((location.hash.match(/op=([^&]+)/) || [])[1] || '');
  sel.value = ops.some((o) => o.id === want) ? want : ops.some((o) => o.id === '2026-10-17/date/labeling') ? '2026-10-17/date/labeling' : [...ops].sort((a, b) => (a.end < b.end ? 1 : -1))[0]?.id || '*';
  sel.onchange = () => loadOp(sel.value);
  addEventListener('hashchange', () => { const o = decodeURIComponent((location.hash.match(/op=([^&]+)/) || [])[1] || ''); if (o && o !== S.op && [...sel.options].some((x) => x.value === o)) { sel.value = o; loadOp(o); } });
  $('#play').onclick = togglePlay;
  for (const b of document.querySelectorAll('#speeds button')) b.onclick = () => { S.speed = +b.dataset.s; document.querySelectorAll('#speeds button').forEach((x) => x.classList.toggle('on', x === b)); };
  $('#compress').onchange = (e) => { const t = S.tl.toReal(S.c); S.compress = e.target.checked; S.tl = timeline(S.events, { compress: S.compress }); S.c = S.tl.toComp(t); };
  $('#focus').onchange = (e) => { S.focus = e.target.checked; };
  $('#raw').onchange = (e) => { S.raw = e.target.checked; $('#logrows').classList.toggle('raw', S.raw); S.lastLog = ''; };
  $('#live').onclick = toggleLive;
  for (const b of document.querySelectorAll('#views button')) b.onclick = () => showView(b.dataset.v);
  addEventListener('keydown', (e) => { if (e.key === ' ' && e.target === document.body) { e.preventDefault(); togglePlay(); } if (e.key === 'Escape') follow(null); });
  $('#legend').append('read artifact→actor · write actor→artifact · ', h('span', { class: 'lc' }, '— captured '), h('span', { class: 'ld' }, '- - derived '), h('span', { class: 'li' }, '··· inferred '), h('span', { class: 'lr' }, '■ fail/gap'));
  setupCanvas(); setupTimeline();
  await loadOp(sel.value);
  requestAnimationFrame(frame);
}
function fillOps() {
  const sel = $('#op'), cur = sel.value, ops = S.summary.operations; S.opTitle = new Map(ops.map((o) => [o.id, o.title || o.label]));
  sel.replaceChildren(h('option', { value: '*' }, `All operations (${S.summary.counts?.events ?? ''} events)`),
    ...ops.map((o) => h('option', { value: o.id, title: o.packet || '' }, `${'  '.repeat(o.id.split('/').length - 1)}${o.title || o.label}${o.packet && o.id.split('/').length === 2 ? ' — ' + o.packet : ''}  ·  ${o.coverage.events} ev${o.coverage.gaps ? ` · ${o.coverage.gaps} gaps` : ''}`)));
  if (cur) sel.value = cur;
}
async function loadOp(op) {
  if (S.live) { live.stop(); live.start(); } // re-subscribe so the catch-up targets the new operation
  S.op = op; location.hash = 'op=' + encodeURIComponent(op);
  const { events } = await get('/api/events?op=' + encodeURIComponent(op));
  S.filter = null; $('#filterbar').replaceChildren(); setEvents(events, true); if (S.view && S.view !== 'floor') showView(S.view);
  S.playing = false; $('#play').textContent = '▶'; follow(null); select(null);
}
function setEvents(events, reset) {
  S.base = events; if (S.filter) events = events.filter((e) => S.filter.ids.has(e.id));
  S.events = events; S.byId = new Map(events.map((e) => [e.id, e])); S.titles = new Map(events.filter((e) => e.target?.title).map((e) => [e.target.path, e.target.title]));
  const ids = new Set(events.flatMap((e) => [e.actor.id, e.target?.kind === 'actor' ? e.target.id : null]));
  S.actors = S.summary.actors.filter((a) => a.permanent || ids.has(a.id)); S.A = new Map(S.actors.map((a) => [a.id, a]));
  S.L = layout(events, S.actors);
  const keep = S.tl && !reset ? S.tl.toReal(S.c) : null;
  S.tl = timeline(events, { compress: S.compress }); S.c = reset || S.live ? S.tl.duration : S.tl.toComp(keep);
  S.lastLog = ''; S.changed++; coverage();
}
function coverage() {
  const o = S.summary.operations.find((x) => x.id === S.op), cv = o?.coverage || S.events.reduce((m, e) => (e.gap ? m.gaps++ : m[e.provenance]++, m), { captured: 0, derived: 0, inferred: 0, gaps: 0 });
  $('#coverage').replaceChildren('events: ', h('b', { class: 'c' }, cv.captured), ' captured · ', h('b', { class: 'd' }, cv.derived), ' derived · ', h('b', { class: 'i' }, cv.inferred), ' inferred · ', h('b', { class: cv.gaps ? 'g' : 'g0' }, cv.gaps), ' gaps',
    o?.inferred ? h('span', { class: 'i' }, ' · operation inferred') : '');
}
function togglePlay() { if (S.live) toggleLive(); if (!S.playing && S.c >= S.tl.duration) S.c = 0; S.playing = !S.playing; $('#play').textContent = S.playing ? '❚❚' : '▶'; }

// ---- live (SSE) ----------------------------------------------------------------------------------------------------
const live = liveClient({
  refetch: async () => ({ summary: await get('/api/summary'), events: (await get('/api/events?op=' + encodeURIComponent(S.op))).events }),
  onReset: ({ summary, events }) => { S.summary = summary; fillOps(); setEvents(events, false); },
  onDelta: (d) => applyLive(d),
});
function toggleLive() {
  S.live = !S.live; $('#live').classList.toggle('live-on', S.live); $('#live').textContent = S.live ? '● Live (on)' : '● Live';
  if (!S.live) return live.stop();
  S.playing = false; $('#play').textContent = '▶';
  live.start(); // its hello triggers a catch-up refetch, on every (re)connect
}
// The same fold as replay: live upserts land in the same event list the replay renderer reads.
export function applyLive(msg) {
  for (const a of msg.actors || []) { const i = S.summary.actors.findIndex((x) => x.id === a.id); if (i >= 0) S.summary.actors[i] = a; else S.summary.actors.push(a); }
  if (msg.operations) { S.summary.operations = msg.operations; fillOps(); }
  const rm = new Set(msg.removes || []), byId = new Map((S.base || S.events).filter((e) => !rm.has(e.id)).map((e) => [e.id, e]));
  for (const e of msg.upserts || []) if (inOp(e, S.op)) byId.set(e.id, e); else byId.delete(e.id);
  setEvents([...byId.values()].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.seq - b.seq)), false);
}

// ---- follow ----------------------------------------------------------------------------------------------------------
function follow(id) {
  S.follow = id; const f = $('#following');
  f.replaceChildren(id ? h('span', { title: 'Escape to stop following' }, `following: ${nameOf(id)} `, h('button', { on: { click: () => follow(null) } }, '✕')) : '');
  if (id) select({ type: 'actor', id });
  S.lastLog = '';
}
const followSet = () => S.follow ? new Set([S.follow, ...descendants(S.follow, S.actors)]) : null;

// ---- floor -----------------------------------------------------------------------------------------------------------
let cv, ctx, W = 0, H = 0, hits = [], dpr = 1;
function setupCanvas() {
  cv = $('#floor'); ctx = cv.getContext('2d');
  const fit = () => { const r = cv.getBoundingClientRect(); dpr = devicePixelRatio || 1; W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr; };
  new ResizeObserver(fit).observe(cv); fit();
  const local = (e) => [(e.offsetX - S.cam.x) / S.cam.s, (e.offsetY - S.cam.y) / S.cam.s];
  cv.addEventListener('mousemove', (e) => { const hit = hitTest(...local(e)), tip = $('#tip'); S.hover = hit; cv.style.cursor = hit ? 'pointer' : 'default';
    if (hit) { tip.style.display = 'block'; tip.style.left = e.offsetX + 12 + 'px'; tip.style.top = e.offsetY + 8 + 'px'; tip.textContent = hit.tip; } else tip.style.display = 'none'; });
  cv.addEventListener('click', (e) => { const hit = hitTest(...local(e)); select(hit ? hit.sel : null); });
  cv.addEventListener('dblclick', (e) => { const hit = hitTest(...local(e)); if (hit?.sel.type === 'actor' && !S.A.get(hit.sel.id)?.permanent) follow(hit.sel.id); });
}
const P = ([x, y]) => [x * W, y * H];
function hitTest(x, y) { for (let i = hits.length - 1; i >= 0; i--) { const k = hits[i]; if (k.r ? Math.hypot(x - k.x, y - k.y) <= k.r : k.w && x >= k.x && x <= k.x + k.w && y >= k.y && y <= k.y + k.h) return k; }
  let best = null, bd = 6; for (const k of hits) if (k.pts) for (let i = 1; i < k.pts.length; i++) { const d = segDist(x, y, ...k.pts[i - 1], ...k.pts[i]); if (d < bd) { bd = d; best = k; } } return best; }
const segDist = (px, py, x1, y1, x2, y2) => { const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l)); return Math.hypot(px - x1 - t * dx, py - y1 - t * dy); };
// Curved edge: a quadratic bend to the right of the direction of travel, so A→B and B→A separate and parallel edges fan out.
const bend = (a, b, k = 0.14) => { const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1]; return [mx - dy * k, my + dx * k]; };
const qpt = (a, c, b, t) => [(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]];

function draw(t) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); hits = [];
  const st = stateAt(S.events, S.actors, t, { travel: 1500 * (S.live ? 1 : S.speed), pulse: 2500 * Math.max(1, (S.live ? 1 : S.speed) / 4) }), now = performance.now();
  const vis = S.focus || S.follow ? visibleAt(S.events, S.actors, t, { follow: S.follow }) : null;
  const shown = (id) => !vis || vis.actors.has(id) || vis.hubs.has(id);
  // camera: follow keeps the pinned agent centred and a little larger
  const fp = S.follow && S.L.pos.get(S.follow), want = fp ? { s: 1.5, x: W / 2 - fp[0] * W * 1.5, y: H / 2 - fp[1] * H * 1.5 } : { s: 1, x: 0, y: 0 };
  for (const k of ['x', 'y', 's']) S.cam[k] += (want[k] - S.cam[k]) * 0.12;
  ctx.setTransform(dpr * S.cam.s, 0, 0, dpr * S.cam.s, dpr * S.cam.x, dpr * S.cam.y);
  for (const g of ARTIFACT) { if (!shown(g)) continue; const [x, y] = P(PERM[g]), a = S.A.get(g), s = st.actors.get(g); const w = 92, hh = 26;
    ctx.fillStyle = '#161b22'; ctx.strokeStyle = s?.pulse ? COL.cap : '#30363d'; ctx.lineWidth = 1; ctx.fillRect(x - w / 2, y - hh / 2, w, hh); ctx.strokeRect(x - w / 2, y - hh / 2, w, hh);
    ctx.fillStyle = COL.fg; ctx.font = '11px system-ui'; ctx.textAlign = 'center'; ctx.fillText(a?.label || g, x, y + 4);
    hits.push({ x: x - w / 2, y: y - hh / 2, w, h: hh, tip: a?.label || g, sel: { type: 'group', id: g } }); }
  const touched = new Map(); for (const e of S.events) { if (Date.parse(e.ts) > t) break; if (e.target?.kind === 'file' && (!vis || vis.actors.has(e.actor.id) || vis.hubs.has(e.actor.id))) touched.set(e.target.path, Date.parse(e.ts)); }
  const over = {}; for (const [p, c] of S.L.chips) if (c.overflow && touched.has(p)) over[c.group] = (over[c.group] || 0) + 1;
  for (const [g, n] of Object.entries(over)) { if (!shown(g)) continue; const [x, y] = P(PERM[g]); ctx.fillStyle = '#8b949e'; ctx.font = '10px ui-monospace,Menlo,monospace'; ctx.textAlign = 'center'; ctx.fillText(`+${n} files`, x, y - 17); }
  ctx.textAlign = 'left';
  for (const [p, c] of S.L.chips) { if (!touched.has(p) || c.overflow || !shown(c.group)) continue; const [x, y] = P(c.pos), age = t - touched.get(p), hot = age < 1500 * (S.live ? 1 : S.speed);
    const w = 0.08 * W - 4; ctx.fillStyle = hot ? '#1f2a36' : '#141920'; ctx.fillRect(x, y - 8, w, 15); ctx.strokeStyle = hot ? COL.cap : '#262d36'; ctx.strokeRect(x, y - 8, w, 15);
    ctx.fillStyle = hot ? COL.fg : '#8b949e'; ctx.font = '10px ui-monospace,Menlo,monospace'; ctx.fillText(fit(S.titles?.get(p) || base(p), w - 6), x + 3, y + 3);
    hits.push({ x, y: y - 8, w, h: 15, tip: `${S.titles?.get(p) || base(p)} — ${short(p)}`, sel: { type: 'file', id: p } }); }
  // edges: only active ones, bundled per (from, to) pair, curved
  const bundles = new Map();
  for (const ed of st.edges) { const e = S.byId.get(ed.id); if (!e || (vis && (!shown(e.actor.id) || (e.target?.kind === 'actor' && !shown(e.target.id)) || (e.target?.group && !shown(e.target.group))))) continue; const ep = endpoints(e, S.L); if (!ep) continue;
    const [a, b] = ep.map(P), key = `${a.map(Math.round)}|${b.map(Math.round)}`; const B = bundles.get(key) || bundles.set(key, { a, b, items: [] }).get(key); B.items.push({ ed, e }); }
  for (const { a, b, items } of bundles.values()) {
    const fail = items.some((x) => x.ed.fail), lead = items[items.length - 1].e, c = bend(a, b), n = items.length;
    const col = fail ? COL.red : lead.verb === 'write' ? COL.ok : lead.verb === 'read' ? COL.cap : lead.verb === 'spawn' || lead.verb === 'end' ? '#d2a8ff' : '#c9d1d9';
    const age = Math.min(...items.map((x) => x.ed.age)), alpha = Math.max(0.2, 1 - age / (1500 * (S.live ? 1 : S.speed) * 1.2));
    ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = col; ctx.lineWidth = (fail ? 1.6 : 1) + Math.log2(n); ctx.setLineDash(lead.provenance === 'derived' ? [5, 4] : lead.provenance === 'inferred' ? [1, 3] : []);
    ctx.beginPath(); ctx.moveTo(...a); ctx.quadraticCurveTo(...c, ...b); ctx.stroke(); ctx.setLineDash([]);
    const tip = qpt(a, c, b, 0.94), pre = qpt(a, c, b, 0.86); arrow(pre, tip, col);
    ctx.globalAlpha = 1; for (const { ed } of items) { const [px, py] = qpt(a, c, b, ed.p); ctx.fillStyle = ed.fail ? COL.red : col; ctx.beginPath(); ctx.arc(px, py, ed.fail ? 3.5 : 2.6, 0, 7); ctx.fill(); }
    ctx.restore();
    // edge label: plain-words summary at the curve's midpoint (active edges only; the full text is in the tooltip)
    const summary = bundleSummary(items.map((x) => x.e), nameOf), [lx, ly] = qpt(a, c, b, 0.5), hovered = S.hover?.sel?.id === lead.id;
    ctx.font = '9px system-ui'; ctx.textAlign = 'center'; const label = hovered ? summary : fit(summary, 170), tw = ctx.measureText(label).width;
    ctx.globalAlpha = Math.max(0.55, alpha); ctx.fillStyle = '#0d1014cc'; ctx.fillRect(lx - tw / 2 - 2, ly - 9, tw + 4, 12); ctx.fillStyle = fail ? COL.red : '#c9d1d9'; ctx.fillText(label, lx, ly); ctx.globalAlpha = 1; ctx.textAlign = 'left';
    hits.push({ pts: [0, 0.2, 0.4, 0.6, 0.8, 1].map((k) => qpt(a, c, b, k)), tip: `${nameOf(lead.actor.id)}: ${summary}`, sel: { type: 'event', id: lead.id } });
  }
  // actors
  for (const a of S.actors) { if (ARTIFACT.has(a.id) || !shown(a.id)) continue; const s = st.actors.get(a.id), pos = S.L.pos.get(a.id); if (!pos) continue;
    if (!s && !a.permanent) continue;
    const [x, y] = P(pos), r = a.permanent ? 15 : 8, col = KIND[a.kind] || KIND.unknown, state = s?.state || 'idle';
    const failed = state === 'ended' && /error|no-go|fail|missing|no-output|stopped/.test(s.outcome || '');
    ctx.save(); ctx.globalAlpha = state === 'ended' ? (failed ? 1 : 0.35) : state === 'idle' ? 0.55 : 1;
    if (s?.pulse) { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 3 + 6 * (1 - s.pulse) + Math.sin(now / 160) * 1.2, 0, 7); ctx.globalAlpha = 0.25 + 0.6 * s.pulse; ctx.stroke(); ctx.globalAlpha = 1; }
    ctx.fillStyle = state === 'unknown' ? 'transparent' : state === 'open' || state === 'idle' ? '#161b22' : col; ctx.strokeStyle = col; ctx.lineWidth = 1.5;
    if (state === 'unknown') ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    const ring = state === 'blocked' || failed ? COL.red : state === 'waiting' ? COL.amber : null;
    if (ring) { ctx.strokeStyle = ring; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y, r + 3, 0, 7); ctx.stroke(); }
    if (S.follow === a.id) { ctx.strokeStyle = COL.amber; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(x, y, r + 8, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
    if (state === 'ended') { ctx.fillStyle = failed ? COL.red : COL.ok; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center'; ctx.fillText(failed ? '✕' : '✓', x, y + 3.5); }
    if (state === 'unknown') { ctx.fillStyle = '#8b949e'; ctx.font = '9px system-ui'; ctx.textAlign = 'center'; ctx.fillText('?', x, y + 3); }
    if (s && (s.fails || s.gaps)) { ctx.fillStyle = s.fails ? COL.red : COL.amber; ctx.font = 'bold 9px ui-monospace,Menlo,monospace'; ctx.textAlign = 'left'; ctx.fillText(`${s.fails ? '✕' + s.fails : ''}${s.gaps ? ' gap' + s.gaps : ''}`, x + r + 2, y - r + 2); }
    ctx.globalAlpha = state === 'ended' && !failed ? 0.5 : 1; ctx.fillStyle = a.permanent ? COL.fg : '#9da7b1'; ctx.font = a.permanent ? '11px system-ui' : '10px system-ui'; ctx.textAlign = 'center';
    const nm = nameOf(a.id), cell = Math.max(60, S.L.cell * W - 8) * (vis ? 1.6 : 1);
    // floor label: what it works on, then what it is (the operation is already in the picker; the Inspector has the full name)
    if (a.permanent) ctx.fillText(fit(nm, 150), x, y + r + 11);
    else { const parts = nm.split(' · '), l1 = parts.length > 2 ? parts[parts.length - 1] : nm, l2 = parts.length > 2 ? parts.slice(0, 2).join(' · ') : '';
      ctx.fillText(fit(l1, cell), x, y + r + 11); if (l2) { ctx.fillStyle = '#6b7682'; ctx.fillText(fit(l2, cell), x, y + r + 22); } }
    if (!a.permanent && state !== 'ended') { ctx.fillStyle = state === 'active' ? col : '#6b7682'; ctx.font = '9px ui-monospace,Menlo,monospace'; ctx.fillText(state, x, y + r + 33); }
    ctx.restore();
    hits.push({ x, y, r: r + 4, tip: `${nm} · ${state}${s?.outcome ? ' · ' + s.outcome : ''}${a.permanent ? '' : ' · double-click to follow'}`, sel: { type: 'actor', id: a.id } }); }
  if (S.sel?.type === 'actor') { const p = S.L.pos.get(S.sel.id); if (p && shown(S.sel.id)) { const [x, y] = P(p); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(x, y, 22, 0, 7); ctx.stroke(); ctx.setLineDash([]); } }
  if (vis && !vis.actors.size) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#6b7682'; ctx.font = '12px system-ui'; ctx.textAlign = 'center'; ctx.fillText('No activity in the last 10 minutes of this timeline (focus mode). Untick "focus" for the full map.', W / 2, 24); }
}
// "labeler · Claude · date labeling · T-3911f729" -> two lines at a separator, each fitted to the cell
function twoLines(s, w) { if (ctx.measureText(s).width <= w) return [s]; const parts = s.split(' · '); let i = parts.length - 1; while (i > 1 && ctx.measureText(parts.slice(0, i).join(' · ')).width > w) i--; return [fit(parts.slice(0, i).join(' · '), w), fit(parts.slice(i).join(' · '), w)]; }
function fit(s, w) { s = String(s || ''); if (ctx.measureText(s).width <= w) return s; while (s.length > 2 && ctx.measureText(s + '…').width > w) s = s.slice(0, -1); return s + '…'; }
function arrow([x1, y1], [x2, y2], col) { const a = Math.atan2(y2 - y1, x2 - x1); ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - 7 * Math.cos(a - 0.4), y2 - 7 * Math.sin(a - 0.4)); ctx.lineTo(x2 - 7 * Math.cos(a + 0.4), y2 - 7 * Math.sin(a + 0.4)); ctx.fill(); }

// ---- timeline --------------------------------------------------------------------------------------------------------
let tc, tctx;
function setupTimeline() {
  tc = $('#tl'); tctx = tc.getContext('2d');
  const fitT = () => { const r = tc.getBoundingClientRect(), d = devicePixelRatio || 1; tc.width = r.width * d; tc.height = r.height * d; tctx.setTransform(d, 0, 0, d, 0, 0); };
  new ResizeObserver(fitT).observe(tc); fitT();
  let drag = false; const seek = (e) => { if (S.live) toggleLive(); const r = tc.getBoundingClientRect(); S.c = Math.max(0, Math.min(1, (e.clientX - r.left - 8) / (r.width - 16))) * S.tl.duration; };
  tc.addEventListener('mousedown', (e) => { drag = true; seek(e); }); addEventListener('mousemove', (e) => drag && seek(e)); addEventListener('mouseup', () => (drag = false));
}
function drawTimeline() {
  const r = tc.getBoundingClientRect(), w = r.width - 16, hh = r.height, d = S.tl.duration || 1, x = (c) => 8 + (c / d) * w;
  tctx.clearRect(0, 0, r.width, hh); const bins = new Array(Math.max(1, Math.floor(w / 3))).fill(0);
  for (const e of S.events) bins[Math.min(bins.length - 1, Math.floor((S.tl.toComp(Date.parse(e.ts)) / d) * bins.length))]++;
  const mx = Math.max(1, ...bins); tctx.fillStyle = '#2b4a66'; bins.forEach((n, i) => { if (n) { const bh = 3 + (n / mx) * (hh - 12); tctx.fillRect(8 + (i / bins.length) * w, hh - bh - 2, Math.max(1, w / bins.length - 1), bh); } });
  tctx.strokeStyle = '#3a434d'; tctx.setLineDash([2, 2]); for (const b of S.tl.breaks) { tctx.beginPath(); tctx.moveTo(x(b.at) + 0.5, 2); tctx.lineTo(x(b.at) + 0.5, hh - 2); tctx.stroke(); } tctx.setLineDash([]);
  for (const e of S.events) if (isFailure(e)) { tctx.fillStyle = e.verb === 'deviation' ? COL.amber : COL.red; tctx.fillRect(x(S.tl.toComp(Date.parse(e.ts))) - 1, 1, 2, 9); }
  tctx.fillStyle = S.live ? COL.red : '#fff'; tctx.fillRect(x(S.c) - 1, 0, 2, hh);
}

// ---- narration strip / raw log -----------------------------------------------------------------------------------------
function drawLog(t) {
  let idx = -1; for (let i = 0; i < S.events.length; i++) if (Date.parse(S.events[i].ts) <= t) idx = i; else break;
  const key = `${idx}|${S.changed}|${S.follow}|${S.raw}`; if (key === S.lastLog) return; S.lastLog = key;
  const fs = followSet(), pick = (e) => !fs || fs.has(e.actor.id) || (e.target?.kind === 'actor' && fs.has(e.target.id));
  const past = []; for (let i = idx; i >= 0 && past.length < 80; i--) if (pick(S.events[i])) past.unshift(i);
  const next = []; for (let i = idx + 1; i < S.events.length && next.length < 3; i++) if (pick(S.events[i])) next.push(i);
  const rows = [...past, ...next].map((i) => row(S.events[i], i === past[past.length - 1], i > idx));
  const story = S.follow ? agentStory(S.base || S.events, S.follow, nameOf, Date.now()) : '';
  const box = h('div', { class: 'rows' }, story ? h('div', { class: 'story' }, story) : '', rows); $('#logrows').replaceChildren(box); const cur = box.querySelector('.now'); if (cur) cur.scrollIntoView({ block: 'end' });
}
const PROV = { captured: '●', derived: '◐', inferred: '○' };
function row(e, now, future) {
  const cls = [now ? 'now' : '', future ? 'future' : '', e.verb === 'deviation' ? 'gap' : isFailure(e) ? 'fail' : ''].join(' ');
  const click = { click: () => { if (S.live) toggleLive(); S.c = S.tl.toComp(Date.parse(e.ts)); select({ type: 'event', id: e.id }); } };
  if (!S.raw) return h('div', { class: cls, on: click, title: `${e.ts} · ${e.provenance}` }, h('span', { class: 't' }, e.ts.slice(11, 19), ' '), h('span', { class: 'p p-' + e.provenance }, PROV[e.provenance]), ' ', narrate(e, nameOf, opTitleOf));
  return h('div', { class: cls, on: click },
    h('span', { class: 't' }, e.ts.slice(11, 23), ' '), h('span', { class: 'p p-' + e.provenance, title: e.provenance }, PROV[e.provenance]), ' ',
    h('span', {}, nameOf(e.actor.id)), ' ', h('span', { class: 'v' }, e.verb), ' ', e.target?.path ? short(e.target.path) : nameOf(e.target?.id) || '', e.label ? `  — ${e.label}` : '', e.outcome && e.outcome !== 'ok' ? `  [${e.outcome}]` : '');
}

// ---- inspector ---------------------------------------------------------------------------------------------------------
const badge = (p) => h('span', { class: 'badge b-' + p }, p);
const outBadge = (o) => o ? h('span', { class: 'badge ' + (/error|no-go|fail|missing|gap|stopped|blocked|no-output/.test(o) ? 'b-fail' : /launched|background|conditional|running/.test(o) ? 'b-warn' : 'b-ok') }, o) : '';
const kv = (rows) => h('table', {}, rows.filter((r) => r && r[1] != null && r[1] !== '').map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', {}, v))));
function select(sel) {
  S.sel = sel; const box = $('#inspector');
  if (!sel) return box.replaceChildren(h('div', { class: 'empty' }, 'Click a node, an edge, a chip or a sentence. Double-click an agent to follow it. Summaries show metadata only; content needs Expand.'));
  if (sel.type === 'event') return box.replaceChildren(eventCard(S.byId.get(sel.id)));
  if (sel.type === 'actor') return box.replaceChildren(actorCard(sel.id));
  if (sel.type === 'file') { const evs = S.events.filter((e) => e.target?.path === sel.id);
    return box.replaceChildren(h('h3', {}, base(sel.id)), kv([['path', h('span', { class: 'path' }, sel.id)], ['touches', evs.length]]), evList(evs), expandBtn(() => get('/api/expand/file?path=' + encodeURIComponent(sel.id)).then((r) => [{ title: 'current content', ...r }]))); }
  if (sel.type === 'group') { box.replaceChildren(h('h3', {}, S.A.get(sel.id)?.label || sel.id), h('div', { class: 'note' }, 'loading artifacts…'));
    get(`/api/artifacts?op=${encodeURIComponent(S.op)}&group=${sel.id}`).then((arts) => box.replaceChildren(h('h3', {}, S.A.get(sel.id)?.label || sel.id), kv([['artifacts', arts.length + (S.op !== '*' ? ' in this operation' : '')]]),
      h('div', { class: 'rows' }, arts.map((a) => h('div', { title: a.path, on: { click: () => select({ type: 'file', id: a.path }) } }, short(a.path), h('span', { class: 'note' }, `  ${a.size}b ${a.mtime.slice(0, 16)}`)))))); }
}
function eventCard(e) {
  if (!e) return h('div', { class: 'empty' }, 'event not in this operation');
  return h('div', {}, h('h3', {}, narrate(e, nameOf, opTitleOf), badge(e.provenance), outBadge(e.outcome)),
    kv([['actor', `${nameOf(e.actor.id)} (${e.actor.kind})`], ['verb', e.verb], ['target', e.target ? (e.target.path ? h('span', { class: 'path' }, e.target.path) : `${e.target.kind}: ${nameOf(e.target.id)}`) : ''], ['label', e.label],
      ['time', `${e.ts}${e.until ? ' → ' + e.until : ''}`], ['time from', e.tsSource], ['operation', e.operation ? `${opTitleOf(e.operation)}${e.opInferred ? ' (inferred)' : ''}` : '—'],
      ['cost', e.cost ? Object.entries(e.cost).filter(([, v]) => v != null).map(([k, v]) => `${k} ${v}`).join(' · ') : ''], ['findings', e.findings], ['gap', e.gap ? `${e.gap.direction}${e.gap.ref ? ' · ' + e.gap.ref : ''}` : ''],
      ['source', h('span', { class: 'path mono' }, `${short(e.source)}${e.detailRef?.lines?.length ? ':' + e.detailRef.lines.map((n) => n + 1).join(',') : ''}`)], ['id', h('span', { class: 'mono' }, e.id)]]),
    expandBtn(() => get('/api/expand/event/' + e.id).then((r) => r.sections), 'Expand', () => get('/api/expand/event/' + e.id + '/prose').then((r) => r.sections)));
}
function actorCard(id) {
  const a = S.A.get(id) || { id, label: id, kind: '?' }, own = S.events.filter((e) => e.actor.id === id), spawn = S.events.find((e) => e.verb === 'spawn' && e.target?.id === id), end = own.find((e) => e.verb === 'end');
  const verbs = {}; for (const e of own) verbs[e.verb] = (verbs[e.verb] || 0) + 1; const prov = {}; for (const e of own) prov[e.provenance] = (prov[e.provenance] || 0) + 1;
  const fails = own.filter(isFailure).length, cost = end?.cost, kids = descendants(id, S.actors);
  const story = a.permanent ? '' : agentStory(S.base || S.events, id, nameOf);
  return h('div', {}, h('h3', {}, nameOf(id), outBadge(end?.outcome)), story ? h('div', { class: 'story' }, story) : '',
    !a.permanent ? h('button', { on: { click: () => follow(S.follow === id ? null : id) } }, S.follow === id ? 'Stop following' : 'Follow this agent') : '',
    kv([['kind', a.kind], ['label', a.label !== a.name ? a.label : ''], ['parent', a.parent ? nameOf(a.parent) + (a.parentInferred ? ' (inferred)' : '') : ''], ['operation', a.operation ? opTitleOf(a.operation) : ''],
    ['children', kids.length || ''], ['spawned', spawn ? `${spawn.ts} ${spawn.provenance}` : a.permanent ? 'permanent' : 'no spawn event (unknown)'], ['ended', end ? `${end.ts} (${end.tsSource})` : a.permanent ? '' : 'no end event'],
    ['events', Object.entries(verbs).map(([k, v]) => `${k} ${v}`).join(' · ')], ['provenance', Object.entries(prov).map(([k, v]) => `${k} ${v}`).join(' · ')], ['failures', fails || ''],
    ['cost', cost ? Object.entries(cost).filter(([, v]) => v != null).map(([k, v]) => `${k} ${v}`).join(' · ') : '']]),
    (end || spawn) && !a.permanent ? expandBtn(() => get('/api/expand/event/' + (end || spawn).id).then((r) => r.sections), 'Expand: prompt, files read, output', () => get('/api/expand/event/' + (end || spawn).id + '/prose').then((r) => r.sections)) : '', evList(own));
}
const evList = (evs) => h('details', { open: evs.length < 40 ? '' : null }, h('summary', {}, `${evs.length} events`), h('div', { class: 'rows' }, evs.slice(-400).map((e) => row(e, false, false))));
// Expand (second click) shows checked content; agent prose stays a stub until "Show unverified agent text" (third click).
function expandBtn(load, label = 'Expand', loadProse = null) {
  const wrap = h('div', {}), b = h('button', { on: { click: async () => { b.disabled = true; b.textContent = 'loading…';
    try { const secs = await load(); b.remove(); const nodes = secs.map(section); wrap.append(...nodes);
      const stubs = secs.map((s, i) => [s, nodes[i]]).filter(([s]) => s.prose && s.hidden);
      if (stubs.length && loadProse) {
        const pb = h('button', { on: { click: async () => { pb.disabled = true; try { const prose = await loadProse(); prose.forEach((s, i) => stubs[i] && stubs[i][1].replaceWith(section(s))); pb.parentElement.remove(); } catch (err) { pb.textContent = 'failed: ' + err.message; } } } }, 'Show unverified agent text');
        wrap.prepend(h('div', { class: 'prose-gate' }, pb, h('span', { class: 'note' }, ` ${stubs.length} section${stubs.length === 1 ? '' : 's'} of agent-written text: redacted, but not checked against the allowlist.`)));
      }
    } catch (err) { b.textContent = 'failed: ' + err.message; } } } }, label);
  wrap.append(b); return wrap;
}
const section = (s) => h('details', { open: s.hidden ? null : '' }, h('summary', {}, s.title, s.path ? h('span', { class: 'note' }, '  ' + short(s.path)) : '', s.truncated ? h('span', { class: 'badge b-warn' }, 'truncated') : '', s.prose ? h('span', { class: 'badge b-warn' }, 'agent text') : ''),
  s.allowed === false ? h('div', { class: 'withheld' }, s.note || 'off-allowlist: path only', s.path ? h('div', { class: 'path mono' }, s.path) : '') : s.note ? h('div', { class: 'note' }, s.note) : '',
  s.text != null ? h('pre', {}, s.text) : s.content != null ? h('pre', {}, s.content) : '');

// ---- O3 views: workflow graph, experiment fans, archive -------------------------------------------------------------------
function showView(v) {
  S.view = v; for (const b of document.querySelectorAll('#views button')) b.classList.toggle('on', b.dataset.v === v);
  const box = $('#view'); if (v === 'floor') { box.hidden = true; return; }
  box.hidden = false; box.replaceChildren(h('div', { class: 'sub' }, 'loading…'));
  (v === 'workflow' ? workflowView : v === 'rooms' ? roomsView : archiveView)(box).catch((e) => box.replaceChildren(h('pre', { class: 'fatal' }, e.message)));
}
// filter the floor and narration to one step's events (clicking a step)
function setFilter(ids, label) {
  S.filter = ids ? { ids: new Set(ids), label } : null;
  $('#filterbar').replaceChildren(ids ? h('span', {}, `step: ${label} (${ids.length} events) `, h('button', { on: { click: () => setFilter(null) } }, '✕')) : '');
  setEvents(S.base || S.events, true); showView('floor');
}
const SVGNS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}, ...kids) => { const n = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) k === 'on' ? Object.entries(v).forEach(([e, f]) => n.addEventListener(e, f)) : n.setAttribute(k, v); for (const c of kids.flat()) if (c != null) n.append(c instanceof Node ? c : document.createTextNode(String(c))); return n; };
const chipOf = (o) => h('span', { class: 'chip ' + (o === 'no-go' ? 'nogo' : /go/.test(o) ? 'go' : 'other') }, o === 'no-go' ? 'NO-GO' : o === 'go' ? 'GO' : o);
async function workflowView(box) {
  if (S.op === '*') return box.replaceChildren(h('div', { class: 'sub' }, 'Pick an operation to see its workflow.'));
  const { workflow: w } = await get('/api/workflow?op=' + encodeURIComponent(S.op));
  if (!w) return box.replaceChildren(h('div', { class: 'sub' }, 'No workflow template applies to this operation.'));
  const out = [h('h2', {}, `${w.template.title} — ${opTitleOf(S.op)}`), h('div', { class: 'sub' }, w.template.about || '', ' · outline = template, solid = run, dashed = heuristic match, solid border = direct match. Click a step to filter the floor.')];
  for (const r of w.rounds) {
    const W = 128, H = 38, gap = 16, steps = r.steps, width = steps.length * (W + gap) + 20, top = 46;
    const svg = sv('svg', { width, height: top + H + 30, viewBox: `0 0 ${width} ${top + H + 30}` });
    steps.forEach((st, i) => { const x = 10 + i * (W + gap);
      if (i) svg.append(sv('path', { class: 'wf-arrow', d: `M${x - gap} ${top + H / 2} L${x - 3} ${top + H / 2}`, 'marker-end': 'url(#ah)' }));
      const nogo = st.outcomes.includes('no-go') && !st.outcomes.includes('go'), go = st.outcomes.includes('go'), heur = st.status === 'done' && st.heuristic > 0 && st.direct === 0;
      const g = sv('g', { class: ['wf-step', st.status, heur ? 'heur' : '', nogo ? 'nogo' : go ? 'go' : '', st.current ? 'current' : ''].join(' '), on: { click: () => st.events.length ? setFilter(st.events, st.title) : null } },
        sv('title', {}, `${st.title}: ${st.status}${st.status === 'done' ? ` · ${st.direct} direct, ${st.heuristic} heuristic${st.evidence.length ? ' (from ' + st.evidence.map((p) => p.split('/').pop()).join(', ') + ')' : ''}` : ' (nothing yet)'}`),
        sv('rect', { x, y: top, width: W, height: H, rx: 5 }), sv('text', { x: x + 8, y: top + 16 }, st.title), sv('text', { x: x + 8, y: top + 30, class: 'dim small' }, st.status === 'done' ? `${st.events.length || st.evidence.length} · ${st.direct ? st.direct + ' direct ' : ''}${st.heuristic ? st.heuristic + ' heuristic' : ''}` : 'not yet'));
      svg.append(g); });
    for (const l of r.loops) { const def = w.template.loops.find((x) => x.id === l.id) || { steps: [] }, ix = steps.map((s, i) => (def.steps.includes(s.id) ? i : -1)).filter((i) => i >= 0); if (!ix.length || !l.count) continue;
      const x0 = 10 + ix[0] * (W + gap) + 10, x1 = 10 + ix[ix.length - 1] * (W + gap) + W - 10;
      svg.append(sv('path', { class: 'wf-loop', d: `M${x1} ${top} C ${x1} ${top - 30}, ${x0} ${top - 30}, ${x0} ${top}`, 'marker-end': 'url(#lh)' }), sv('text', { x: (x0 + x1) / 2 - 60, y: top - 24, class: 'wf-loop-label' }, `${l.title} ×${l.count}: ${l.direct} direct, ${l.heuristic} heuristic`)); }
    svg.prepend(sv('defs', {}, sv('marker', { id: 'ah', markerWidth: 8, markerHeight: 8, refX: 6, refY: 3, orient: 'auto' }, sv('path', { d: 'M0,0 L6,3 L0,6 Z', fill: '#4a5560' })),
      sv('marker', { id: 'lh', markerWidth: 8, markerHeight: 8, refX: 6, refY: 3, orient: 'auto' }, sv('path', { d: 'M0,0 L6,3 L0,6 Z', fill: '#f0b429' }))));
    const verdicts = r.loops.filter((l) => l.count).map((l) => h('div', { class: 'sub' }, `${l.title}: `, l.verdicts.map(chipOf)));
    out.push(h('h2', {}, `Round ${r.n}${r.plan ? ' — ' + (S.titles?.get(r.plan) || r.plan.split('/').pop()) : ''}`), svg, ...verdicts);
  }
  out.push(h('h2', {}, `Unplanned (${w.unplanned.length})`), h('div', { class: 'sub' }, 'Events that fit no step, or more than one (never assigned arbitrarily).'),
    h('div', { class: 'rows' }, w.unplanned.map((u) => { const e = S.byId.get(u.id) || (S.base || []).find((x) => x.id === u.id);
      return h('div', { on: { click: () => e && select({ type: 'event', id: u.id }) } }, h('span', { class: 't' }, u.ts.slice(0, 19).replace('T', ' '), ' '), e ? narrate(e, nameOf, opTitleOf) : u.id, h('span', { class: 'note' }, `  [${u.reason}${u.candidates ? ': ' + u.candidates.join(' | ') : ''}]`)); })));
  box.replaceChildren(...out);
}
async function roomsView(box) {
  const { runs } = await get('/api/rooms?op=' + encodeURIComponent(S.op));
  if (!runs.length) return box.replaceChildren(h('div', { class: 'sub' }, 'No driver runs in this operation.'));
  const out = [];
  for (const run of runs) {
    out.push(h('h2', {}, run.manifest.replace(/^manifest-|\.jsonl$/g, '') + ' run'), h('div', { class: run.masked ? 'sub masked' : 'sub' }, run.masked ? `Arms masked: ${run.unmask.reason}. Rooms are lettered A/B inside each pair.` : 'Unmasked by a valid restricted/unmask.json.'));
    for (const p of run.pairs) out.push(h('div', { class: 'pair' }, h('div', { class: 'note' }, `pair ${p.pair}`), p.lanes.map((L) => h('div', { class: 'lane' + (L.stopped ? ' stopped' : '') }, h('span', { class: 'nm' }, L.name + (L.stopped ? ' (stopped)' : '')),
      L.ticks.map((t) => h('span', { class: 'tick' + (t.fail ? ' fail' : ''), 'data-ts': Date.parse(t.ts), title: `t${t.turn} ${t.speaker} · ${t.ts.slice(11, 19)}`, on: { click: () => t.eventId && select({ type: 'event', id: t.eventId }) } }))))));
  }
  box.replaceChildren(...out);
}
async function archiveView(box) {
  const search = h('input', { placeholder: 'search titles…', value: S.archiveQ || '' }), list = h('div', {});
  const load = async () => { S.archiveQ = search.value; const { items, now } = await get(`/api/archive?op=${encodeURIComponent(S.op)}&q=${encodeURIComponent(search.value)}`), fresh = Date.parse(now) - 15 * 60e3;
    let op = null; const rows = [];
    for (const a of items) { if (a.operation !== op) { op = a.operation; rows.push(h('div', { class: 'op' }, op ? opTitleOf(op) : 'no operation')); }
      rows.push(h('div', { class: 'row' + (Date.parse(a.mtime) > fresh || Date.parse(a.mtime) > S.loadedAt ? ' new' : ''), title: a.path },
        h('a', { on: { click: () => select({ type: 'file', id: a.path }) } }, a.title), h('span', { class: 'note' }, a.mtime.slice(0, 16).replace('T', ' ')),
        a.writer ? h('a', { on: { click: () => select({ type: 'event', id: a.writer.id }) } }, `written by ${a.writer.actor}`) : h('span', { class: 'note' }, 'writer not seen'),
        a.readerCount ? h('a', { on: { click: () => select({ type: 'event', id: a.readers[a.readers.length - 1].id }) } }, `cited by ${a.readerCount}`) : h('span', { class: 'note' }, '—'))); }
    list.replaceChildren(...rows, items.length ? '' : h('div', { class: 'sub' }, 'nothing matches')); };
  search.addEventListener('input', () => { clearTimeout(S.archiveT); S.archiveT = setTimeout(load, 200); });
  box.replaceChildren(h('div', { class: 'arch' }, h('h2', {}, `Archive — ${S.op === '*' ? 'all operations' : opTitleOf(S.op)}`), search, list)); await load();
}

// ---- loop ----------------------------------------------------------------------------------------------------------------
let prev = performance.now(), lastCard = '';
function frame(now) {
  const dt = Math.min(100, now - prev); prev = now;
  if (S.tl) {
    if (S.live) S.c = S.tl.duration;
    else if (S.playing) { S.c += dt * S.speed; if (S.c >= S.tl.duration) { S.c = S.tl.duration; S.playing = false; $('#play').textContent = '▶'; } }
    const t = S.live ? Math.max(Date.now(), S.tl.end) : S.tl.toReal(S.c); draw(t); drawTimeline(); drawLog(t);
    // the Inspector tracks a followed agent as its events arrive
    if (S.follow && S.sel?.type === 'actor' && S.sel.id === S.follow && lastCard !== `${S.follow}|${S.changed}`) { lastCard = `${S.follow}|${S.changed}`; select(S.sel); }
    // rooms view: turns tick in with the replay clock (ticks after the playhead are dimmed)
    if (S.view === 'rooms' && now - (S.tickAt || 0) > 200) { S.tickAt = now; for (const el of document.querySelectorAll('#view .tick')) el.classList.toggle('future', +el.dataset.ts > t); }
    $('#clock').textContent = S.live ? `${fmtT(t)}  ·  live` : S.tl.duration ? `${fmtT(t)}  ·  ${((S.c / S.tl.duration) * 100).toFixed(0)}%` : 'no events';
  }
  requestAnimationFrame(frame);
}
init().catch((e) => { document.body.append(h('pre', { class: 'fatal' }, 'Office failed to load: ' + e.message)); });
