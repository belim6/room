// Floor model: pure functions from (events, actors, time) to what the floor shows. Shared by the page and the tests,
// so replay is deterministic: the same events and the same t always give the same state. Every visible state is bound
// to an explicit event (PSRI rule 2); with no event there is no animation, and idle/unknown are states of their own.

export const PERM = {
  deniz: [0.05, 0.50], coordinator: [0.27, 0.50], critic: [0.27, 0.13], server: [0.55, 0.88], providers: [0.05, 0.88], outside: [0.05, 0.13],
  repo: [0.20, 0.95], transcripts: [0.12, 0.70], archive: [0.88, 0.10], ledger: [0.88, 0.36], vault: [0.88, 0.62], rooms: [0.88, 0.88],
  // O4: one node per role (its sessions in the Inspector), PSRI outside Room, and work/ (+ research/) as an artifact node
  'role:partner': [0.15, 0.36], 'role:operator': [0.15, 0.62], 'role:secretary': [0.05, 0.30], 'role:prompter': [0.27, 0.31], 'role:experimenter': [0.27, 0.67],
  'role:housekeeper': [0.30, 0.82], 'role:engineer': [0.38, 0.94], psri: [0.72, 0.95], work: [0.88, 0.23],
  // 2026-10-26 roles, at the free spots farthest from existing nodes
  'role:jev-correspondent': [0.18, 0.21], 'role:brainstormer': [0.16, 0.06], 'role:intern': [0.20, 0.79],
};

// Operation tree display and matching are kept pure so the same rules can be tested without a browser.
export function operationTreeRows(tree) {
  if (!tree || tree.error) return [];
  const nodes = tree.nodes || [], byParent = new Map();
  for (const n of nodes) (byParent.get(n.parent) || byParent.set(n.parent, []).get(n.parent)).push(n);
  const out = [];
  const walk = (n, depth) => { out.push({ ...n, depth }); for (const c of byParent.get(n.id) || []) walk(c, depth + 1); };
  for (const n of byParent.get(null) || []) walk(n, 0);
  return out;
}
export function parseOfficeRoute(hash = '') {
  const value = String(hash).replace(/^#/, '');
  if (!value || value === '/') return { page: 'home' };
  const legacy = value.match(/^op=(.*)$/);
  if (legacy) return { page: 'operation', id: decodeURIComponent(legacy[1]), tab: 'floor', legacy: true };
  const match = value.match(/^\/op\/([^/]+)\/(floor|workflow|rooms|archive)$/);
  return match ? { page: 'operation', id: decodeURIComponent(match[1]), tab: match[2] } : { page: 'home' };
}
export function officeRouteHash(route) {
  return route?.page === 'operation' ? `#/op/${encodeURIComponent(route.id)}/${route.tab || 'floor'}` : '#/';
}
export function createRouteGuard() {
  let token = 0;
  return { begin() { return ++token; }, current(value) { return value === token; } };
}
export function validOfficeOperationRoute(route, tree, operations = []) {
  if (route?.page !== 'operation' || !['floor','workflow','rooms','archive'].includes(route.tab)) return false;
  return tree && !tree.error ? (tree.nodes || []).some(n => n.id === route.id) : route.id === '*' || operations.some(o => o.id === route.id);
}
export function operationBreadcrumb(tree, id) {
  const rows = tree?.nodes || [], byId = new Map(rows.map(n => [n.id, n])), path = [];
  let node = byId.get(id), seen = new Set();
  while (node && !seen.has(node.id)) { seen.add(node.id); path.unshift({ id: node.id, title: node.title || node.id }); node = node.parent ? byId.get(node.parent) : null; }
  return [{ id: null, title: 'Home' }, ...path];
}
export function runningStripModel(events, actors, tree, now = Date.now()) {
  const byActor = new Map();
  for (const e of events || []) {
    if (!e.actor?.id) continue;
    const old = byActor.get(e.actor.id);
    if (!old || Date.parse(e.ts) > Date.parse(old.ts)) byActor.set(e.actor.id, e);
  }
  const out = [];
  for (const [id, e] of byActor) {
    const actor = (actors || []).find(a => a.id === id);
    if (!actor || actor.permanent || /end|finish|complete|stop|fail|error/i.test(e.verb || '')) continue;
    const start = Date.parse(e.ts), age = Math.max(0, now - start);
    if (!Number.isFinite(start) || age > 10 * 60_000) continue;
    const placement = operationPlacement(e.operation, tree?.nodes || []);
    const node = (tree?.nodes || []).find(n => n.id === placement) || (placement ? null : (tree?.nodes || []).find(n => n.id === 'unfiled'));
    out.push({ actorId: id, who: actor.name || actor.label || id, nodeId: placement || 'unfiled', nodeTitle: node?.title || placement || 'Unfiled', ageMs: age, burn: operationTreeDisplay(node || {}).burn });
  }
  return out;
}
export function operationTreeCard(n, largestSiblingTokens = null) {
  const d = operationTreeDisplay(n), t = n.tokenUsage, tokens = d.tokensFull === 'n/a' ? null : Number(d.tokensFull);
  const largest = largestSiblingTokens;
  const raw=(n.status||'history').toLowerCase(), status=n.id==='unfiled'?'unfiled':n.close?'closed':(['done','complete','completed'].includes(raw)?'done':['active','paused','history'].includes(raw)?raw:'history');
  return { id:n.id, title:n.title || n.id, status, events:d.events, knownEvents:d.knownEvents, tokenEvents:`${d.knownEvents}/${d.totalTokenEvents} events have tokens`, tokens:d.tokens, tokensFull:d.tokensFull, share:tokens == null || !largest ? 0 : Math.max(0,Math.min(1,tokens/largest)), tokenValue:tokens };
}
export function operationTreeGraph(tree, collapsed = new Set(), { cardWidth=220, cardHeight=64, gapX=60, gapY=24 } = {}) {
  const rows=operationTreeRows(tree), kids=new Map();
  for(const n of rows) (kids.get(n.parent)||kids.set(n.parent,[]).get(n.parent)).push(n);
  const visible=[], edges=[]; let cursor=0;
  const count=(n)=>{if(collapsed.has(n.id))return 1;const cs=kids.get(n.id)||[];return cs.length?cs.reduce((s,c)=>s+count(c),0):1;};
  const place=(n,depth)=>{const x=depth*(cardWidth+gapX),entry={...n,x,y:cursor*(cardHeight+gapY),collapsed:collapsed.has(n.id),hiddenCount:0};visible.push(entry);cursor++;
    const cs=kids.get(n.id)||[];
    if(collapsed.has(n.id)){const descendants=(id)=>(kids.get(id)||[]).reduce((s,c)=>s+1+descendants(c.id),0);entry.hiddenCount=descendants(n.id);return;}
    for(const c of cs){place(c,depth+1);edges.push({from:n.id,to:c.id});}
  };
  for(const root of kids.get(null)||[]) if(root.id!=='unfiled') { const before=cursor; place(root,0); const used=cursor-before; cursor += Math.max(0,count(root)-used); }
  const sibs=new Map(); for(const n of visible){ const key=n.parent||'__root'; (sibs.get(key)||sibs.set(key,[]).get(key)).push(n); }
  for(const group of sibs.values()){ const vals=group.map(n=>operationTreeCard(n).tokenValue).filter(Number.isFinite), max=Math.max(0,...vals); for(const n of group)n.card=operationTreeCard(n,max); }
  const unfiled=rows.find(n=>n.id==='unfiled'); if(unfiled){ visible.push({...unfiled,x:0,y:cursor*(cardHeight+gapY),detached:true,card:operationTreeCard(unfiled)}); }
  return {nodes:visible,edges,width:Math.max(cardWidth,...visible.map(n=>n.x+cardWidth)),height:Math.max(cardHeight,...visible.map(n=>n.y+cardHeight)),cardWidth,cardHeight};
}
export function operationGraphPointerHandlers({ select, pan, capture = () => {}, threshold = 4 }) {
  let start = null, target = null, twist = false, moved = false, suppressClick = false;
  return {
    down(e) { start = [e.clientX, e.clientY]; target = e.target?.closest?.('.op-node'); twist = !!e.target?.closest?.('.op-open'); suppressClick=false; moved = false; },
    move(e) {
      if (!start) return;
      const dx=e.clientX-start[0], dy=e.clientY-start[1];
      if (!moved && Math.hypot(dx,dy) <= threshold) return;
      if (!moved) { moved=true; capture(e.pointerId); }
      pan(dx,dy); start=[e.clientX,e.clientY];
    },
    up() { if(moved)suppressClick=true; if (start && !moved && target && !twist) { select(target); suppressClick=true; } start=null; target=null; twist=false; moved=false; },
    cancel() { start=null; target=null; twist=false; moved=false; },
    click(e) { if (!suppressClick) return true; suppressClick=false; e.preventDefault(); e.stopPropagation(); return false; }
  };
}
export function operationTreeNodeEvents(events, tree, id) {
  const nodes = tree?.nodes || [], byId = new Map(nodes.map(n => [n.id, n]));
  if (id === 'unfiled') return events.filter(e => !operationPlacement(e.operation, nodes));
  const ids = new Set([id]); let changed = true;
  while (changed) { changed = false; for (const n of nodes) if (n.parent && ids.has(n.parent) && !ids.has(n.id)) { ids.add(n.id); changed = true; } }
  return events.filter(e => { const placed = operationPlacement(e.operation, nodes); return !!placed && ids.has(placed); });
}
const fraction = (n, d) => `${n ?? 0}/${d ?? 0}`;
export function operationTreeDisplay(n) {
  const t = n.tokenUsage, budget = n.budget || {}, events = n.eventCount || 0;
  const known = t?.eventsWithTokens ?? t?.knownEvents ?? 0, total = t?.events ?? t?.totalEvents ?? events;
  const sum = t && known ? (t.input || 0) + (t.output || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0) : null;
  const allowance = budget.tokens ?? budget.tokenAllowance ?? budget.token_allowance;
  const burn = sum == null || allowance == null ? 'n/a' : `${sum}/${allowance}`;
  const compact = (value) => {
    if (value == null) return 'n/a';
    const abs = Math.abs(value);
    for (const [limit, unit] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) if (abs >= limit) return `${Number((value / limit).toFixed(3))}${unit}`;
    return String(value);
  };
  return { events: String(events), gaps: fraction(n.gapCount || 0, events), tokenGaps: fraction(Math.max(0, total - known), total), known: fraction(known, total), knownEvents: String(known), totalTokenEvents: String(total), unfiled: n.unfiledEventCount ? String(n.unfiledEventCount) : '', tokens: compact(sum), tokensFull: sum == null ? 'n/a' : String(sum), tokenHint: `${known} of ${total} events have a number`, budget: Object.entries(budget).map(([k, v]) => `${k}: ${v}`).join(' · '), burn };
}
export const ARTIFACT = new Set(['archive', 'ledger', 'vault', 'rooms', 'repo', 'outside', 'transcripts', 'work']);
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

// ---- O2: focus, follow, narration ------------------------------------------------------------------------------
// Focus: only actors with activity in (t - window, t], actors still open at t, and failed actors in the window; plus the
// permanent hub nodes those actors touched in the window. Everything else is hidden (not dimmed). Pure, like stateAt.
export function visibleAt(events, actors, t, { window = 10 * 60e3, follow = null } = {}) {
  const A = new Map(actors.map((a) => [a.id, a])), open = new Map(), vis = new Set(), hubs = new Set(), recent = [];
  for (const e of events) {
    const ts = T(e.ts); if (ts > t) break;
    if (e.verb === 'spawn' && e.target?.kind === 'actor') open.set(e.target.id, true);
    if (e.verb === 'end') open.set(e.actor.id, false);
    if (t - ts <= window) recent.push(e);
  }
  for (const [id, o] of open) if (o) vis.add(id);
  for (const e of recent) { vis.add(e.actor.id); if (e.target?.kind === 'actor') vis.add(e.target.id); }
  if (follow) { const keep = new Set([follow, ...descendants(follow, actors)]); for (const id of [...vis]) if (!keep.has(id) && !A.get(id)?.permanent) vis.delete(id); for (const id of keep) if (open.get(id) !== undefined || recent.some((e) => e.actor.id === id)) vis.add(id); }
  for (const e of recent) if (vis.has(e.actor.id)) { if (A.get(e.actor.id)?.permanent) hubs.add(e.actor.id); const g = e.target?.group || (e.target?.kind === 'actor' && A.get(e.target.id)?.permanent ? e.target.id : null); if (g) hubs.add(g); if (e.verb === 'spawn' && A.get(e.actor.id)?.permanent) hubs.add(e.actor.id); }
  for (const id of [...vis]) { const p = A.get(id)?.parent; if (p && A.get(p)?.permanent) hubs.add(p); if (A.get(id)?.permanent) { vis.delete(id); hubs.add(id); } }
  return { actors: vis, hubs };
}
export function descendants(id, actors) { const out = []; let frontier = [id]; while (frontier.length) { const next = actors.filter((a) => frontier.includes(a.parent)).map((a) => a.id).filter((x) => !out.includes(x)); out.push(...next); frontier = next; } return out; }

// Narration: one plain sentence per event, from templates over metadata only (no model call, no content).
const FILE_WORDS = [[/labeler-prompt\.md$/, 'the labeler instructions'], [/rubric[^/]*\.md$/, 'the rubric'], [/\/blind\/(T-[0-9a-f]+)\.md$/, 'transcript $1'],
  [/\/labels\/[^/]+\/(T-[0-9a-f]+)\.json$/, 'its verdict for $1'], [/restricted\/key\.json$/, 'the unmasking key'], [/manifest-[\w-]+\.jsonl$/, 'the driver manifest'], [/events\.jsonl$/, 'the handoff log']];
export function fileWords(p = '', title = '') { for (const [re, w] of FILE_WORDS) { const m = p.match(re); if (m) return w.replace('$1', m[1] || ''); } return title || p.split('/').pop() || p; }
const OUTCOME = { verdict: 'returned its verdict', done: 'finished', 'no-go': 'ruled NO-GO', go: 'ruled GO', 'conditional-go': 'ruled conditional GO', error: 'failed', 'no-output': 'ended without output',
  'extraction-failed': 'returned output that could not be parsed', 'extraction-failed-repaired': 'returned output that had to be repaired', stopped: 'was stopped' };
export function narrate(e, nameOf, opTitle = (x) => x) {
  const who = nameOf(e.actor.id), tgt = e.target, them = tgt?.kind === 'actor' ? nameOf(tgt.id) : '', file = tgt?.kind === 'file' ? fileWords(tgt.path, tgt.title) : '';
  const tag = e.provenance === 'derived' ? ' (derived)' : e.provenance === 'inferred' ? ' (inferred)' : '';
  switch (e.verb) {
    case 'spawn': return `${who} started ${them}${tag}.`;
    case 'end': { const o = OUTCOME[e.outcome] || e.outcome || 'finished'; const f = e.findings ? ` (${e.findings} finding${e.findings === 1 ? '' : 's'})` : '';
      return e.actor.kind === 'critic' && /go/.test(e.outcome || '') ? `The critic ${o}${e.operation ? ' on ' + opTitle(e.operation) : ''}${f}.` : `${who} ${o}${f}${tag}.`; }
    case 'read': return `${who} opened ${file || them || 'something'}${tag}.`;
    case 'write': return tgt?.kind === 'branch' ? `${who} created a room branch.` : `${who} wrote ${file || 'a file'}${tag}.`;
    case 'message': if (e.label === 'peer') return `${who} asked ${them}${e.outcome === 'error' ? ' (not delivered)' : ''}${tag}.`;
      if (e.label === 'peer-reply') return `${who} replied to ${them}${e.outcome === 'error' ? ' (not delivered)' : ''}${tag}.`;
      if (e.label === 'commission') return `${who} commissioned research from PSRI: ${tgt?.title || 'a brief'}${tag}.`;
      if (e.label === 'delivery') return `PSRI delivered research to ${them}: ${tgt?.title || 'a synthesis'}${tag}.`;
      if (e.label === 'packet' && tgt?.id === 'critic') return `${who} asked the critic for a review${tag}.`;
      return e.actor.id === 'deniz' ? `Deniz wrote to ${them || 'the coordinator'}.` : tgt?.id === 'deniz' ? `${who} wrote to Deniz.` : e.label?.startsWith('result') ? `${who} reported back to ${them}.` : `${who} sent ${them || 'someone'} a message${e.label && !/^(packet|review|result)$/.test(e.label) ? '' : e.label ? ' (' + e.label + ')' : ''}.`;
    case 'dispatch': return tgt?.id === 'providers' ? `${who} started a Codex run.` : tgt?.id === 'server' ? `${who} asked the stable server for ${e.label || 'a turn'}.` : `${who} ran ${e.label || 'a command'}${e.outcome === 'error' ? ' (it failed)' : ''}.`;
    case 'turn': return `The stable server produced ${e.label || 'a turn'}.`;
    case 'rule': return `${who}: ${e.label || 'check'}.`;
    case 'wait': return `${who} is waiting on ${them || 'something'}.`;
    case 'block': return `${who} is blocked${e.label ? ': ' + e.label : ''}.`;
    case 'unblock': return `${who} is unblocked.`;
    case 'error': return e.outcome === 'missing' ? `Missing: ${e.label}.` : `${who} hit an error${e.label ? ': ' + e.label : ''}.`;
    case 'deviation': return `Coverage gap: ${e.label}.`;
    default: return `${who} ${e.verb} ${file || them}.`;
  }
}

// Edge labels: what an edge is, in a few plain words, from the same metadata as the narration (verb, target name, event
// label, outcome). Deterministic; no content, no agent prose.
const lastPart = (name = '') => name.split(' · ').pop();
export function edgeSummary(e, nameOf = (x) => x, opTitle = (x) => x) {
  const t = e.target, them = t?.kind === 'actor' ? nameOf(t.id) : '', file = t?.kind === 'file' ? fileWords(t.path, t.title).replace(/^the /, '') : '';
  const fail = e.outcome === 'error' ? ' (failed)' : '';
  switch (e.verb) {
    case 'read': return `reads ${file || 'a file'}${fail}`;
    case 'write': return t?.kind === 'branch' ? 'creates a room branch' : `writes ${/^its verdict/.test(fileWords(t?.path, t?.title)) ? fileWords(t.path, t.title).replace(/^its /, '') : file || 'a file'}${fail}`;
    case 'spawn': return `starts ${lastPart(them) || 'an agent'}`;
    case 'end': { const f = e.findings ? ` (${e.findings} finding${e.findings === 1 ? '' : 's'})` : '';
      return e.outcome === 'no-go' ? `rules NO-GO${f}` : e.outcome === 'go' ? `rules GO${f}` : e.outcome === 'conditional-go' ? `rules conditional GO${f}` : e.outcome === 'verdict' ? 'returns its verdict'
        : /error|fail|no-output/.test(e.outcome || '') ? `ends: ${e.outcome}` : 'reports back'; }
    // the topic only when the operation is explicit: an inferred one (from paths a message names) is often wrong (review P2)
    case 'message': if (e.label === 'peer' || e.label === 'peer-reply') { const op = e.operation && e.opInferred === false ? opTitle(e.operation) : '';
        return `${e.label === 'peer' ? 'asks' : 'replies to'} ${lastPart(them) || 'a session'}${op ? ': ' + op : ''}${e.outcome === 'error' ? ' (not delivered)' : ''}`; }
      if (e.label === 'commission') return `commissions research on ${t?.title || 'a brief'}`;
      if (e.label === 'delivery') return `delivers research: ${t?.title || 'a synthesis'}`;
      return e.label === 'packet' ? `sends a packet to ${lastPart(them) || 'review'}` : e.label === 'review' ? 'returns a review' : t?.id === 'deniz' ? 'writes to Deniz' : e.actor.id === 'deniz' ? 'writes to the coordinator' : e.label?.startsWith('result') ? 'reports back' : `messages ${lastPart(them) || 'an agent'}`;
    // e.label is only compared, never printed: labels can carry agent-written text
    case 'dispatch': return t?.id === 'server' ? (e.label && /\bt\d+\b/.test(e.label) ? 'dispatches a turn' : 'dispatches work') : t?.id === 'providers' ? 'starts a Codex run' : t?.kind === 'tool' && /^[\w.-]+$/.test(t.id) ? `runs ${t.id}${fail}` : t?.kind === 'workflow' ? 'runs a workflow' : `runs a command${fail}`;
    case 'turn': return 'produces a turn';
    case 'block': return 'is blocked';
    case 'error': return e.outcome === 'missing' ? 'missing label' : 'error';
    case 'deviation': return 'coverage gap';
    default: return e.verb;
  }
}
// Bundled edges (same pair): the count, then the latest summary, with the distinct objects when they differ.
export function bundleSummary(items, nameOf = (x) => x, opTitle = (x) => x) {
  const sums = items.map((e) => edgeSummary(e, nameOf, opTitle)), latest = sums[sums.length - 1];
  if (items.length === 1) return latest;
  const verb = latest.split(' ')[0], same = sums.every((s) => s.split(' ')[0] === verb);
  if (same && (verb === 'reads' || verb === 'writes')) { const objs = [...new Set(sums.map((s) => s.slice(verb.length + 1)))]; return `${verb} ${items.length} file${items.length === 1 ? '' : 's'}: ${objs.join(', ')}`; }
  if (same && verb === 'dispatches') return `dispatches ${items.length} turns`;
  return `${items.length}×, latest: ${latest}`;
}

// ---- O3: agent-side narrative --------------------------------------------------------------------------------------------
// A running plain-words summary of what one agent has done, from templates over its events (never from its prose).
const list = (xs, max = 4) => { const u = [...new Set(xs)]; if (!u.length) return ''; const head = u.slice(0, max), more = u.length - head.length;
  const body = head.length > 1 ? `${head.slice(0, -1).join(', ')} and ${head[head.length - 1]}` : head[0]; return more > 0 ? `${body} (+${more} more)` : body; };
const dur = (ms) => (ms < 90e3 ? `${Math.max(0, Math.round(ms / 1000))} s` : ms < 90 * 60e3 ? `${Math.round(ms / 60e3)} min` : `${(ms / 3600e3).toFixed(1)} h`);
export function agentStory(events, actorId, nameOf = (x) => x, now = Date.now()) {
  const own = events.filter((e) => e.actor.id === actorId), spawn = events.find((e) => e.verb === 'spawn' && e.target?.id === actorId), end = own.find((e) => e.verb === 'end');
  if (!own.length && !spawn) return '';
  const parts = [], reads = own.filter((e) => e.verb === 'read' && e.target?.kind === 'file').map((e) => fileWords(e.target.path, e.target.title).replace(/^the /, 'the '));
  const writes = own.filter((e) => e.verb === 'write' && e.target?.kind === 'file').map((e) => fileWords(e.target.path, e.target.title));
  if (reads.length) parts.push(`read ${list(reads)}`);
  if (writes.length) parts.push(`wrote ${list(writes)}`);
  const kids = own.filter((e) => e.verb === 'spawn').length; if (kids) parts.push(`started ${kids} agent${kids === 1 ? '' : 's'}`);
  const cmds = own.filter((e) => e.verb === 'dispatch').length; if (cmds) parts.push(`ran ${cmds} command${cmds === 1 ? '' : 's'}`);
  const msgs = own.filter((e) => e.verb === 'message').length; if (msgs) parts.push(`sent ${msgs} message${msgs === 1 ? '' : 's'}`);
  const errs = own.filter((e) => e.verb === 'error' || e.outcome === 'error').length; if (errs) parts.push(`hit ${errs} error${errs === 1 ? '' : 's'}`);
  const t0 = Date.parse((spawn || own[0]).ts);
  if (end) { const o = OUTCOME[end.outcome] || 'finished', f = end.findings ? ` (${end.findings} finding${end.findings === 1 ? '' : 's'})` : ''; parts.push(`${o}${f}`); parts.push(`finished in ${dur(Date.parse(end.ts) - t0)}`); }
  else parts.push(`working for ${dur(now - t0)} so far`);
  return `${nameOf(actorId)}: ${parts.join('; ')}.`;
}
import { operationPlacement } from './operation-placement.mjs';

// Wheel deltas are in screen coordinates. Pinch/modifier zoom preserves the world point under the cursor.
export function operationGraphWheel(cam, { deltaX=0, deltaY=0, deltaMode=0, ctrlKey=false, metaKey=false }, point, pageHeight=800) {
  const unit=deltaMode===1?16:deltaMode===2?pageHeight:1;
  if(!ctrlKey&&!metaKey)return {...cam,x:cam.x-deltaX*unit,y:cam.y-deltaY*unit};
  return operationGraphZoom(cam,Math.exp(-deltaY*unit*.002),point);
}
export function operationGraphZoom(cam,factor,{x,y}) {
  const s=Math.max(.6,Math.min(2.5,cam.s*factor)),ratio=s/cam.s;
  return {x:x-(x-cam.x)*ratio,y:y-(y-cam.y)*ratio,s};
}
export function visibleOperationNodes(tree, expanded=new Set()) {
  const rows=operationTreeRows(tree),visible=new Set();
  return rows.filter(n=>{const show=n.id!=='unfiled'&&(n.parent==null||(visible.has(n.parent)&&expanded.has(n.parent)));if(show)visible.add(n.id);return show;});
}
// Reserve a stable slot at each depth independent of disclosure. Hidden branches cannot move existing cards.
export function progressiveOperationGraph(tree, expanded=new Set()) {
  const full=operationTreeGraph(tree),rows=operationTreeRows(tree),slots=new Map(),positions=new Map();
  const groups=new Map(),lastParent=new Map();
  // a new sibling group at the same depth starts 28px lower, so neighbouring groups do not read as one list
  for(const n of rows){const slot=slots.get(n.depth)||0,g=(groups.get(n.depth)||0)+(slot&&lastParent.get(n.depth)!==n.parent?1:0);slots.set(n.depth,slot+1);groups.set(n.depth,g);lastParent.set(n.depth,n.parent);positions.set(n.id,{x:n.depth*280,y:slot*104+g*28});}
  const visible=new Set(visibleOperationNodes(tree,expanded).map(n=>n.id));
  const nodes=full.nodes.filter(n=>visible.has(n.id)).map(n=>({...n,...positions.get(n.id),collapsed:!expanded.has(n.id),childCount:rows.filter(c=>c.parent===n.id).length}));
  return {...full,nodes,edges:full.edges.filter(e=>visible.has(e.from)&&visible.has(e.to)),cardHeight:88,width:Math.max(220,...nodes.map(n=>n.x+220)),height:Math.max(88,...nodes.map(n=>n.y+88))};
}
export function centreOperationGraph(graph,id,{width,height},includeChildren=true) {
  const nodes=graph.nodes.filter(n=>n.id===id||(includeChildren&&n.parent===id));
  if(!nodes.length)return {x:12,y:12,s:1};
  const left=Math.min(...nodes.map(n=>n.x)),top=Math.min(...nodes.map(n=>n.y));
  const right=Math.max(...nodes.map(n=>n.x+graph.cardWidth)),bottom=Math.max(...nodes.map(n=>n.y+graph.cardHeight));
  const s=Math.max(.6,Math.min(1.2,(width-32)/(right-left),(height-32)/(bottom-top)));
  return {x:width/2-(left+right)/2*s,y:height/2-(top+bottom)/2*s,s};
}

// ---- Home polish: recent operations, document groups, breadcrumb ellipsis, unfiled by day, edge paths ----------------
export function relativeAgo(ms) {
  const m = Math.max(0, Math.floor(ms / 60e3));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`;
}
// Nodes ordered by their newest placed event (the most specific node, not its ancestors); unfiled is left out.
export function recentOperations(events, tree, now = Date.now(), limit = 10) {
  const nodes = tree?.nodes || [], byId = new Map(nodes.map(n => [n.id, n])), cache = new Map(), acc = new Map();
  for (const e of events || []) {
    const ts = Date.parse(e.ts); if (!Number.isFinite(ts)) continue;
    if (!cache.has(e.operation)) cache.set(e.operation, operationPlacement(e.operation, nodes));
    const id = cache.get(e.operation); if (!id || !byId.has(id)) continue;
    const a = acc.get(id) || acc.set(id, { last: 0, day: 0 }).get(id);
    if (ts > a.last) a.last = ts; if (now - ts <= 24 * 3600e3 && ts <= now) a.day++;
  }
  return [...acc].sort((a, b) => b[1].last - a[1].last || a[0].localeCompare(b[0])).slice(0, limit).map(([id, a]) => {
    const n = byId.get(id), p = n.parent ? byId.get(n.parent) : null;
    return { id, title: n.title || id, parentTitle: p ? p.title || p.id : '', lastTs: a.last, ago: relativeAgo(now - a.last), last24h: a.day };
  });
}
export function nodeAncestors(tree, id) {
  const byId = new Map((tree?.nodes || []).map(n => [n.id, n])), out = [], seen = new Set();
  let n = byId.get(id); while (n?.parent && !seen.has(n.parent)) { seen.add(n.parent); out.unshift(n.parent); n = byId.get(n.parent); }
  return out;
}
const DOC_KINDS = [['results', 'Results & summaries'], ['plans', 'Plans & READMEs'], ['critic', 'Critic reviews'], ['packets', 'Packets'], ['scripts', 'Scripts'], ['other', 'Other'], ['raw', 'Raw logs']];
const stemOf = (p = '') => p.split('/').pop().replace(/\.[A-Za-z0-9]+$/, '');
// Machine-named records: numeric, hash-like, or "<word> item 4045"-style stems; their titles carry no meaning.
export const machineNamed = (p = '') => { const s = stemOf(p); return /^[\d._-]+$/.test(s) || /^[0-9a-f]{8,}$/i.test(s) || /^[0-9a-f-]{20,}$/i.test(s) || /^[a-z]+[-_ ](item|turn|row|record)[-_ ]?\d+$/i.test(s) || /^t\d+$/i.test(s); };
export function documentKind(p = '') {
  const b = p.split('/').pop().toLowerCase();
  if (/\.raw\.log$/.test(b)) return 'raw';
  if (machineNamed(p)) return 'other';
  if (/\.(sh|py|js|mjs|cjs|ts)$/.test(b)) return 'scripts';
  if (/^critic/.test(b) || /\/critic\/[^/]+\.md$/i.test(p)) return 'critic';
  if (/(close|summary|results?|findings)/.test(b)) return 'results';
  if (/(plan|readme|spec)/.test(b)) return 'plans';
  if (/(packet|for-deniz|deniz)/.test(b)) return 'packets';
  return 'other';
}
// Never a bare number as a title: fall back to "file name · folder".
export function documentTitle(d) {
  const t = String(d.title || '').trim(), parts = String(d.path || '').split('/');
  return !t || !/[a-z]/i.test(t.replace(/\b(item|turn|row|record)\b/gi, '')) || machineNamed(d.path) ? `${parts.pop() || t} · ${parts.slice(-2).join('/')}` : t;
}
export function groupNodeDocuments(items) {
  const groups = new Map(DOC_KINDS.map(([k, label]) => [k, { kind: k, label, items: [], collapsed: k === 'other' || k === 'raw' }]));
  for (const d of items || []) groups.get(documentKind(d.path)).items.push({ ...d, display: documentTitle(d), machine: machineNamed(d.path) });
  for (const g of groups.values()) g.items.sort(g.kind === 'critic' ? (a, b) => String(b.mtime).localeCompare(String(a.mtime)) : (a, b) => a.machine - b.machine || a.display.localeCompare(b.display, 'en', { numeric: true }));
  return [...groups.values()].filter(g => g.items.length);
}
// Home and the last two crumbs stay; the middle collapses to one "…" carrying the hidden titles.
export function breadcrumbDisplay(crumbs, { keepLast = 2, maxChars = 70 } = {}) {
  const chars = crumbs.reduce((s, c) => s + String(c.title).length + 3, 0);
  if (crumbs.length <= keepLast + 2 && chars <= maxChars || crumbs.length <= keepLast + 1) return { crumbs, full: crumbs.map(c => c.title).join(' › ') };
  const middle = crumbs.slice(1, -keepLast);
  return { crumbs: [crumbs[0], { id: undefined, ellipsis: true, title: '…', hidden: middle.map(c => c.title) }, ...crumbs.slice(-keepLast)], full: crumbs.map(c => c.title).join(' › ') };
}
const localDay = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
export function unfiledByDay(events, tree, now = Date.now()) {
  const nodes = tree?.nodes || [], today = localDay(now), y = new Date(now); y.setDate(y.getDate() - 1);
  const yesterday = localDay(y.getTime()), cache = new Map(); let t = 0, yd = 0;
  for (const e of events || []) {
    if (!cache.has(e.operation)) cache.set(e.operation, operationPlacement(e.operation, nodes));
    if (cache.get(e.operation)) continue;
    const ts = Date.parse(e.ts); if (!Number.isFinite(ts)) continue; const d = localDay(ts);
    if (d === today) t++; else if (d === yesterday) yd++;
  }
  return { today: t, yesterday: yd };
}
// Each parent->child edge is its own path: a short stub out of the parent's right edge, then a curve to the child.
export function operationGraphEdgePath(a, b, cardWidth, cardHeight, stub = 14) {
  const x1 = a.x + cardWidth, y1 = a.y + cardHeight / 2, sx = x1 + stub, x2 = b.x, y2 = b.y + cardHeight / 2, mx = sx + Math.max(8, (x2 - sx) / 2);
  return y1 === y2 ? `M${x1},${y1} H${x2}` : `M${x1},${y1} H${sx} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
}
