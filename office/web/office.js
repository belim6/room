import { PERM, ARTIFACT, layout, endpoints, stateAt, timeline, isFailure } from './model.mjs';

const $ = (s) => document.querySelector(s);
const h = (tag, attrs = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) if (v != null) k === 'on' ? Object.entries(v).forEach(([e, f]) => n.addEventListener(e, f)) : k === 'class' ? (n.className = v) : n.setAttribute(k, v);
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c instanceof Node ? c : String(c)); return n; };
const get = (u) => fetch(u).then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(Error(j.error || r.status)))));
const KIND = { human: '#e6edf3', coordinator: '#58a6ff', critic: '#c297ff', labeler: '#3fd0c9', engineer: '#56d364', reviewer: '#f0883e', writer: '#d2a8ff', driver: '#8fb3d9', server: '#9aa7b4', provider: '#7d8590', artifact: '#59636e', unknown: '#7d8590' };
const COL = { cap: '#7cc4ff', der: '#b39cff', inf: '#8b949e', ok: '#4fd18b', amber: '#f0b429', red: '#ff5c5c', dim: '#3a434d', fg: '#c9d1d9' };
const fmtT = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
const short = (p = '') => p.replace(/^.*\/coordination\//, '').replace(/^.*\/prompt-knowledge\//, 'pk/').replace(/^.*\/\.room-data\//, 'rd/').replace(/^\/Users\/[^/]+\//, '~/');
const base = (p = '') => p.split('/').pop();

const S = { summary: null, op: '', events: [], actors: [], A: new Map(), L: null, tl: null, c: 0, playing: false, speed: 10, compress: true, sel: null, hover: null, lastLog: -2, byId: new Map() };

async function init() {
  S.summary = await get('/api/summary');
  const ops = S.summary.operations, sel = $('#op');
  sel.append(h('option', { value: '*' }, `all operations (${S.summary.counts.events} events)`));
  for (const o of ops) sel.append(h('option', { value: o.id }, `${'  '.repeat(o.id.split('/').length - 1)}${o.label}  ·  ${o.coverage.events} ev${o.coverage.gaps ? ` · ${o.coverage.gaps} gaps` : ''}${o.inferred ? ' (op inferred)' : ''}`));
  const want = decodeURIComponent((location.hash.match(/op=([^&]+)/) || [])[1] || '');
  sel.value = ops.some((o) => o.id === want) ? want : ops.some((o) => o.id === '2026-10-17/date/labeling') ? '2026-10-17/date/labeling' : [...ops].sort((a, b) => (a.end < b.end ? 1 : -1))[0]?.id || '*';
  sel.onchange = () => loadOp(sel.value);
  addEventListener('hashchange', () => { const o = decodeURIComponent((location.hash.match(/op=([^&]+)/) || [])[1] || ''); if (o && o !== S.op && [...sel.options].some((x) => x.value === o)) { sel.value = o; loadOp(o); } });
  $('#play').onclick = togglePlay;
  for (const b of document.querySelectorAll('#speeds button')) b.onclick = () => { S.speed = +b.dataset.s; document.querySelectorAll('#speeds button').forEach((x) => x.classList.toggle('on', x === b)); };
  $('#compress').onchange = (e) => { const t = S.tl.toReal(S.c); S.compress = e.target.checked; S.tl = timeline(S.events, { compress: S.compress }); S.c = S.tl.toComp(t); };
  addEventListener('keydown', (e) => { if (e.key === ' ' && e.target === document.body) { e.preventDefault(); togglePlay(); } });
  $('#legend').append('read artifact→actor · write actor→artifact · ', h('span', { class: 'lc' }, '— captured '), h('span', { class: 'ld' }, '- - derived '), h('span', { class: 'li' }, '··· inferred '), h('span', { class: 'lr' }, '■ fail/gap'));
  setupCanvas(); setupTimeline();
  await loadOp(sel.value);
  requestAnimationFrame(frame);
}
async function loadOp(op) {
  S.op = op; location.hash = 'op=' + encodeURIComponent(op);
  const { events } = await get('/api/events?op=' + encodeURIComponent(op));
  S.events = events; S.byId = new Map(events.map((e) => [e.id, e]));
  const ids = new Set(events.flatMap((e) => [e.actor.id, e.target?.kind === 'actor' ? e.target.id : null]));
  S.actors = S.summary.actors.filter((a) => a.permanent || ids.has(a.id)); S.A = new Map(S.actors.map((a) => [a.id, a]));
  S.L = layout(events, S.actors); S.tl = timeline(events, { compress: S.compress }); S.c = S.tl.duration; S.playing = false; $('#play').textContent = '▶';
  const o = S.summary.operations.find((x) => x.id === op), cv = o?.coverage || events.reduce((m, e) => (e.gap ? m.gaps++ : m[e.provenance]++, m), { captured: 0, derived: 0, inferred: 0, gaps: 0 });
  $('#coverage').replaceChildren('events: ', h('b', { class: 'c' }, cv.captured), ' captured · ', h('b', { class: 'd' }, cv.derived), ' derived · ', h('b', { class: 'i' }, cv.inferred), ' inferred · ', h('b', { class: cv.gaps ? 'g' : 'g0' }, cv.gaps), ' gaps',
    o?.inferred ? h('span', { class: 'i' }, ' · operation inferred') : '');
  S.lastLog = -2; select(null);
}
function togglePlay() { if (!S.playing && S.c >= S.tl.duration) S.c = 0; S.playing = !S.playing; $('#play').textContent = S.playing ? '❚❚' : '▶'; }

// ---- floor -------------------------------------------------------------------------------------------------------
let cv, ctx, W = 0, H = 0, hits = [];
function setupCanvas() {
  cv = $('#floor'); ctx = cv.getContext('2d');
  const fit = () => { const r = cv.getBoundingClientRect(), d = devicePixelRatio || 1; W = r.width; H = r.height; cv.width = W * d; cv.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0); };
  new ResizeObserver(fit).observe(cv); fit();
  cv.addEventListener('mousemove', (e) => { const hit = hitTest(e.offsetX, e.offsetY), tip = $('#tip'); S.hover = hit; cv.style.cursor = hit ? 'pointer' : 'default';
    if (hit) { tip.style.display = 'block'; tip.style.left = e.offsetX + 12 + 'px'; tip.style.top = e.offsetY + 8 + 'px'; tip.textContent = hit.tip; } else tip.style.display = 'none'; });
  cv.addEventListener('click', (e) => { const hit = hitTest(e.offsetX, e.offsetY); select(hit ? hit.sel : null); });
}
const P = ([x, y]) => [x * W, y * H];
function hitTest(x, y) { for (let i = hits.length - 1; i >= 0; i--) { const k = hits[i]; if (k.r ? Math.hypot(x - k.x, y - k.y) <= k.r : x >= k.x && x <= k.x + k.w && y >= k.y && y <= k.y + k.h) return k; }
  let best = null, bd = 6; for (const k of hits) if (k.seg) { const d = segDist(x, y, ...k.seg); if (d < bd) { bd = d; best = k; } } return best; }
const segDist = (px, py, x1, y1, x2, y2) => { const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l)); return Math.hypot(px - x1 - t * dx, py - y1 - t * dy); };

function draw(t) {
  ctx.clearRect(0, 0, W, H); hits = [];
  const st = stateAt(S.events, S.actors, t, { travel: 1500 * S.speed, pulse: 2500 * Math.max(1, S.speed / 4) }), now = performance.now();
  // artifact nodes (rects) and file chips
  for (const g of ARTIFACT) { const [x, y] = P(PERM[g]), a = S.A.get(g), s = st.actors.get(g); const w = 92, hh = 26;
    ctx.fillStyle = '#161b22'; ctx.strokeStyle = s?.pulse ? COL.cap : '#30363d'; ctx.lineWidth = 1; ctx.fillRect(x - w / 2, y - hh / 2, w, hh); ctx.strokeRect(x - w / 2, y - hh / 2, w, hh);
    ctx.fillStyle = COL.fg; ctx.font = '11px system-ui'; ctx.textAlign = 'center'; ctx.fillText(a?.label || g, x, y + 4);
    hits.push({ x: x - w / 2, y: y - hh / 2, w, h: hh, tip: a?.label || g, sel: { type: 'group', id: g } }); }
  const touched = new Map(); for (const e of S.events) { if (Date.parse(e.ts) > t) break; if (e.target?.kind === 'file') touched.set(e.target.path, Date.parse(e.ts)); }
  ctx.textAlign = 'left';
  const over = {}; for (const [p, c] of S.L.chips) if (c.overflow && touched.has(p)) over[c.group] = (over[c.group] || 0) + 1;
  for (const [g, n] of Object.entries(over)) { const [x, y] = P(PERM[g]); ctx.fillStyle = '#8b949e'; ctx.font = '10px ui-monospace,Menlo,monospace'; ctx.textAlign = 'center'; ctx.fillText(`+${n} files`, x, y - 17); }
  ctx.textAlign = 'left';
  for (const [p, c] of S.L.chips) { if (!touched.has(p) || c.overflow) continue; const [x, y] = P(c.pos), age = t - touched.get(p), hot = age < 1500 * S.speed;
    const w = 0.08 * W - 4; ctx.fillStyle = hot ? '#1f2a36' : '#141920'; ctx.fillRect(x, y - 8, w, 15); ctx.strokeStyle = hot ? COL.cap : '#262d36'; ctx.strokeRect(x, y - 8, w, 15);
    ctx.fillStyle = hot ? COL.fg : '#8b949e'; ctx.font = '10px ui-monospace,Menlo,monospace'; ctx.fillText(fit(base(p), w - 6), x + 3, y + 3);
    hits.push({ x, y: y - 8, w, h: 15, tip: short(p), sel: { type: 'file', id: p } }); }
  // edges
  for (const ed of st.edges) { const e = S.byId.get(ed.id), ep = e && endpoints(e, S.L); if (!ep) continue;
    const [a, b] = ep.map(P), col = ed.fail ? COL.red : e.verb === 'write' ? COL.ok : e.verb === 'read' ? COL.cap : e.verb === 'spawn' || e.verb === 'end' ? '#d2a8ff' : '#c9d1d9';
    const alpha = Math.max(0.15, 1 - ed.age / (1500 * S.speed * 1.2));
    ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = col; ctx.lineWidth = ed.fail ? 1.6 : 1; ctx.setLineDash(e.provenance === 'derived' ? [5, 4] : e.provenance === 'inferred' ? [1, 3] : []);
    ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); ctx.setLineDash([]); arrow(a, b, col);
    const px = a[0] + (b[0] - a[0]) * ed.p, py = a[1] + (b[1] - a[1]) * ed.p; ctx.globalAlpha = 1; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(px, py, ed.fail ? 3.5 : 2.6, 0, 7); ctx.fill(); ctx.restore();
    hits.push({ seg: [...a, ...b], tip: `${e.actor.label} ${e.verb} ${e.target?.path ? short(e.target.path) : e.target?.id || ''}`, sel: { type: 'event', id: e.id } }); }
  // actors
  for (const a of S.actors) { if (ARTIFACT.has(a.id)) continue; const s = st.actors.get(a.id), pos = S.L.pos.get(a.id); if (!pos) continue;
    if (!s && !a.permanent) continue;
    const [x, y] = P(pos), r = a.permanent ? 15 : 8, col = KIND[a.kind] || KIND.unknown, state = s?.state || 'idle';
    const failed = state === 'ended' && /error|no-go|fail|missing|no-output|stopped/.test(s.outcome || '');
    ctx.save(); ctx.globalAlpha = state === 'ended' ? (failed ? 1 : 0.35) : state === 'idle' ? 0.55 : 1;
    if (s?.pulse) { ctx.strokeStyle = col; ctx.globalAlpha *= 1; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 3 + 6 * (1 - s.pulse) + Math.sin(now / 160) * 1.2, 0, 7); ctx.globalAlpha = 0.25 + 0.6 * s.pulse; ctx.stroke(); ctx.globalAlpha = 1; }
    ctx.fillStyle = state === 'unknown' ? 'transparent' : state === 'open' || state === 'idle' ? '#161b22' : col; ctx.strokeStyle = col; ctx.lineWidth = 1.5;
    if (state === 'unknown') ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    const ring = state === 'blocked' || failed ? COL.red : state === 'waiting' ? COL.amber : null;
    if (ring) { ctx.strokeStyle = ring; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y, r + 3, 0, 7); ctx.stroke(); }
    if (state === 'ended') { ctx.fillStyle = failed ? COL.red : COL.ok; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center'; ctx.fillText(failed ? '✕' : '✓', x, y + 3.5); }
    if (state === 'unknown') { ctx.fillStyle = '#8b949e'; ctx.font = '9px system-ui'; ctx.textAlign = 'center'; ctx.fillText('?', x, y + 3); }
    if (s && (s.fails || s.gaps)) { ctx.fillStyle = s.fails ? COL.red : COL.amber; ctx.font = 'bold 9px ui-monospace,Menlo,monospace'; ctx.textAlign = 'left'; ctx.fillText(`${s.fails ? '✕' + s.fails : ''}${s.gaps ? ' gap' + s.gaps : ''}`, x + r + 2, y - r + 2); }
    ctx.globalAlpha = state === 'ended' && !failed ? 0.5 : 1; ctx.fillStyle = a.permanent ? COL.fg : '#9da7b1'; ctx.font = a.permanent ? '11px system-ui' : '10px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(fit(a.label, a.permanent ? 150 : Math.max(50, S.L.cell * W - 8)), x, y + r + 11);
    if (!a.permanent && state !== 'ended') { ctx.fillStyle = state === 'active' ? col : '#6b7682'; ctx.font = '9px ui-monospace,Menlo,monospace'; ctx.fillText(state, x, y + r + 21); }
    ctx.restore();
    hits.push({ x, y, r: r + 4, tip: `${a.label} · ${a.kind} · ${state}${s?.outcome ? ' · ' + s.outcome : ''}`, sel: { type: 'actor', id: a.id } }); }
  if (S.sel?.type === 'actor') { const p = S.L.pos.get(S.sel.id); if (p) { const [x, y] = P(p); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(x, y, 22, 0, 7); ctx.stroke(); ctx.setLineDash([]); } }
}
function fit(s, w) { s = String(s || ''); if (ctx.measureText(s).width <= w) return s; while (s.length > 2 && ctx.measureText(s + '…').width > w) s = s.slice(0, -1); return s + '…'; }
function arrow([x1, y1], [x2, y2], col) { const a = Math.atan2(y2 - y1, x2 - x1), x = x2 - Math.cos(a) * 12, y = y2 - Math.sin(a) * 12; ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 7 * Math.cos(a - 0.4), y - 7 * Math.sin(a - 0.4)); ctx.lineTo(x - 7 * Math.cos(a + 0.4), y - 7 * Math.sin(a + 0.4)); ctx.fill(); }

// ---- timeline ----------------------------------------------------------------------------------------------------
let tc, tctx;
function setupTimeline() {
  tc = $('#tl'); tctx = tc.getContext('2d');
  const fitT = () => { const r = tc.getBoundingClientRect(), d = devicePixelRatio || 1; tc.width = r.width * d; tc.height = r.height * d; tctx.setTransform(d, 0, 0, d, 0, 0); };
  new ResizeObserver(fitT).observe(tc); fitT();
  let drag = false; const seek = (e) => { const r = tc.getBoundingClientRect(); S.c = Math.max(0, Math.min(1, (e.clientX - r.left - 8) / (r.width - 16))) * S.tl.duration; };
  tc.addEventListener('mousedown', (e) => { drag = true; seek(e); }); addEventListener('mousemove', (e) => drag && seek(e)); addEventListener('mouseup', () => (drag = false));
}
function drawTimeline() {
  const r = tc.getBoundingClientRect(), w = r.width - 16, hh = r.height, d = S.tl.duration || 1, x = (c) => 8 + (c / d) * w;
  tctx.clearRect(0, 0, r.width, hh); const bins = new Array(Math.max(1, Math.floor(w / 3))).fill(0);
  for (const e of S.events) bins[Math.min(bins.length - 1, Math.floor((S.tl.toComp(Date.parse(e.ts)) / d) * bins.length))]++;
  const mx = Math.max(1, ...bins); tctx.fillStyle = '#2b4a66'; bins.forEach((n, i) => { if (n) { const bh = 3 + (n / mx) * (hh - 12); tctx.fillRect(8 + (i / bins.length) * w, hh - bh - 2, Math.max(1, w / bins.length - 1), bh); } });
  tctx.strokeStyle = '#3a434d'; tctx.setLineDash([2, 2]); for (const b of S.tl.breaks) { tctx.beginPath(); tctx.moveTo(x(b.at) + 0.5, 2); tctx.lineTo(x(b.at) + 0.5, hh - 2); tctx.stroke(); } tctx.setLineDash([]);
  for (const e of S.events) if (isFailure(e)) { tctx.fillStyle = e.verb === 'deviation' ? COL.amber : COL.red; tctx.fillRect(x(S.tl.toComp(Date.parse(e.ts))) - 1, 1, 2, 9); }
  tctx.fillStyle = '#fff'; tctx.fillRect(x(S.c) - 1, 0, 2, hh);
}

// ---- event log ---------------------------------------------------------------------------------------------------
function drawLog(t) {
  let idx = -1; for (let i = 0; i < S.events.length; i++) if (Date.parse(S.events[i].ts) <= t) idx = i; else break;
  if (idx === S.lastLog) return; S.lastLog = idx;
  const from = Math.max(0, idx - 60), rows = S.events.slice(from, idx + 4).map((e, k) => row(e, from + k === idx, from + k > idx));
  const box = h('div', { class: 'rows' }, rows); $('#log').replaceChildren(box); const cur = box.querySelector('.now'); if (cur) cur.scrollIntoView({ block: 'end' });
}
const PROV = { captured: '●', derived: '◐', inferred: '○' };
function row(e, now, future) {
  const cls = [now ? 'now' : '', future ? 'future' : '', e.verb === 'deviation' ? 'gap' : isFailure(e) ? 'fail' : ''].join(' ');
  return h('div', { class: cls, on: { click: () => { S.c = S.tl.toComp(Date.parse(e.ts)); select({ type: 'event', id: e.id }); } } },
    h('span', { class: 't' }, e.ts.slice(11, 23), ' '), h('span', { class: 'p p-' + e.provenance, title: e.provenance }, PROV[e.provenance]), ' ',
    h('span', {}, e.actor.label), ' ', h('span', { class: 'v' }, e.verb), ' ', e.target?.path ? short(e.target.path) : S.A.get(e.target?.id)?.label || e.target?.id || '', e.label ? `  — ${e.label}` : '', e.outcome && e.outcome !== 'ok' ? `  [${e.outcome}]` : '');
}

// ---- inspector ---------------------------------------------------------------------------------------------------
const badge = (p) => h('span', { class: 'badge b-' + p }, p);
const outBadge = (o) => o ? h('span', { class: 'badge ' + (/error|no-go|fail|missing|gap|stopped|blocked|no-output/.test(o) ? 'b-fail' : /launched|background|conditional/.test(o) ? 'b-warn' : 'b-ok') }, o) : '';
const kv = (rows) => h('table', {}, rows.filter((r) => r && r[1] != null && r[1] !== '').map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', {}, v))));
function select(sel) {
  S.sel = sel; const box = $('#inspector');
  if (!sel) return box.replaceChildren(h('div', { class: 'empty' }, 'Click a node, an edge, a chip or an event. Summaries show metadata only; content needs Expand.'));
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
  return h('div', {}, h('h3', {}, `${e.actor.label} · ${e.verb}`, badge(e.provenance), outBadge(e.outcome)),
    kv([['actor', `${e.actor.label} (${e.actor.kind})`], ['target', e.target ? (e.target.path ? h('span', { class: 'path' }, e.target.path) : `${e.target.kind}: ${S.A.get(e.target.id)?.label || e.target.id}`) : ''], ['label', e.label],
      ['time', `${e.ts}${e.until ? ' → ' + e.until : ''}`], ['time from', e.tsSource], ['operation', e.operation ? `${e.operation}${e.opInferred ? ' (inferred)' : ''}` : '—'],
      ['cost', e.cost ? Object.entries(e.cost).filter(([, v]) => v != null).map(([k, v]) => `${k} ${v}`).join(' · ') : ''], ['gap', e.gap ? `${e.gap.direction}${e.gap.ref ? ' · ' + e.gap.ref : ''}` : ''],
      ['source', h('span', { class: 'path mono' }, `${short(e.source)}${e.detailRef?.lines?.length ? ':' + e.detailRef.lines.map((n) => n + 1).join(',') : ''}`)], ['id', h('span', { class: 'mono' }, e.id)]]),
    expandBtn(() => get('/api/expand/event/' + e.id).then((r) => r.sections)));
}
function actorCard(id) {
  const a = S.A.get(id) || { id, label: id, kind: '?' }, own = S.events.filter((e) => e.actor.id === id), spawn = S.events.find((e) => e.verb === 'spawn' && e.target?.id === id), end = own.find((e) => e.verb === 'end');
  const verbs = {}; for (const e of own) verbs[e.verb] = (verbs[e.verb] || 0) + 1; const prov = {}; for (const e of own) prov[e.provenance] = (prov[e.provenance] || 0) + 1;
  const fails = own.filter(isFailure).length, cost = end?.cost;
  return h('div', {}, h('h3', {}, a.label, outBadge(end?.outcome)), kv([['kind', a.kind], ['parent', a.parent ? (S.A.get(a.parent)?.label || a.parent) + (a.parentInferred ? ' (inferred)' : '') : ''], ['operation', a.operation],
    ['spawned', spawn ? `${spawn.ts} ${spawn.provenance}` : a.permanent ? 'permanent' : 'no spawn event (unknown)'], ['ended', end ? `${end.ts} (${end.tsSource})` : a.permanent ? '' : 'no end event'],
    ['events', Object.entries(verbs).map(([k, v]) => `${k} ${v}`).join(' · ')], ['provenance', Object.entries(prov).map(([k, v]) => `${k} ${v}`).join(' · ')], ['failures', fails || ''],
    ['cost', cost ? Object.entries(cost).filter(([, v]) => v != null).map(([k, v]) => `${k} ${v}`).join(' · ') : '']]),
    (end || spawn) && !a.permanent ? expandBtn(() => get('/api/expand/event/' + (end || spawn).id).then((r) => r.sections), 'Expand: prompt, files read, output') : '', evList(own));
}
const evList = (evs) => h('details', { open: evs.length < 40 ? '' : null }, h('summary', {}, `${evs.length} events`), h('div', { class: 'rows' }, evs.slice(0, 400).map((e) => row(e, false, false))));
function expandBtn(load, label = 'Expand') {
  const wrap = h('div', {}), b = h('button', { on: { click: async () => { b.disabled = true; b.textContent = 'loading…';
    try { const secs = await load(); b.remove(); wrap.append(...secs.map(section)); } catch (err) { b.textContent = 'failed: ' + err.message; } } } }, label);
  wrap.append(b); return wrap;
}
const section = (s) => h('details', { open: '' }, h('summary', {}, s.title, s.path ? h('span', { class: 'note' }, '  ' + short(s.path)) : '', s.truncated ? h('span', { class: 'badge b-warn' }, 'truncated') : ''),
  s.allowed === false ? h('div', { class: 'withheld' }, s.note || 'off-allowlist: path only', s.path ? h('div', { class: 'path mono' }, s.path) : '') : s.note ? h('div', { class: 'note' }, s.note) : '',
  s.text != null ? h('pre', {}, s.text) : s.content != null ? h('pre', {}, s.content) : '');

// ---- loop --------------------------------------------------------------------------------------------------------
let prev = performance.now();
function frame(now) {
  const dt = Math.min(100, now - prev); prev = now;
  if (S.tl) { if (S.playing) { S.c += dt * S.speed; if (S.c >= S.tl.duration) { S.c = S.tl.duration; S.playing = false; $('#play').textContent = '▶'; } }
    const t = S.tl.toReal(S.c); draw(t); drawTimeline(); drawLog(t);
    $('#clock').textContent = S.tl.duration ? `${fmtT(t)}  ·  ${((S.c / S.tl.duration) * 100).toFixed(0)}%` : 'no events'; }
  requestAnimationFrame(frame);
}
init().catch((e) => { document.body.append(h('pre', { class: 'fatal' }, 'Office failed to load: ' + e.message)); });
