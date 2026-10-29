import express from 'express';
import path from 'node:path';
import { collect, type Collected } from './collect/index';
import { config, redact, redactDeep, type Config } from './collect/privacy';
import { expandEvent } from './collect/expand';
import { hideProse, onlyProse } from './collect/withhold';
import { matchWorkflow, stepNames, roleLoops } from './collect/workflow';
import { fans, maskerFor, maskDeep, opFolderOf, refreshBlind } from './collect/rooms';
import { fileTitle, workStatus } from './collect/legible';
import type { OfficeEvent } from './collect/types';
import { Live, type LiveOpts } from './live';
import { operationPlacement } from './web/operation-placement.mjs';
import { deniedDocument, visibleDocuments } from './collect/deny';
import { nodeDocuments } from './collect/documents';

// The Office: read-only, loopback-only view over saved records. GET routes only; nothing here writes to any source.
const meta = (e: OfficeEvent) => { const { hints, ...m } = e; return m; }; // hints carry command/prompt text: never in the summary tier
const inOp = (e: OfficeEvent, op?: string) => !op || op === '*' || e.operation === op || !!e.operation?.startsWith(op + '/');

export function createOffice(cfg: Config = config(), liveOpts?: LiveOpts) {
  let data: Collected = collect(cfg);
  const live = new Live(() => data, d => { data = d; }, cfg, liveOpts || {});
  const app = express();
  app.disable('x-powered-by'); app.disable('etag');
  app.use((req, res, next) => {
    const host = req.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return res.status(403).json({ error: 'Local connections only' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).set('Allow', 'GET, HEAD').json({ error: 'The Office is read-only.' });
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.path.startsWith('/api/')) { res.setHeader('Cache-Control', 'no-store'); refreshBlind(data.allow); } // fail closed: index any new masked folder before answering
    next();
  });
  // last line of defence: every API string passes redaction, and trajectory ids of masked operations are masked
  const send = (res: any, v: unknown) => res.json(redactDeep(maskDeep(data.allow)(v)));
  app.get('/api/summary', (_req, res) => send(res, {
    collectedAt: data.collectedAt, operations: data.operations, ...(data.operationTree ? { operationTree: data.operationTree } : {}), ...(data.tokenRecords ? { tokenRecords: data.tokenRecords } : {}), actors: [...data.actors.values()],
    sources: data.sources.map(s => ({ ...s })), counts: { events: data.events.length, artifacts: visibleDocuments(data.artifacts, data.allow).length },
  }));
  app.get('/api/events', (req, res) => { const op = String(req.query.op || ''); send(res, { op, events: data.events.filter(e => inOp(e, op)).map(meta) }); });
  app.get('/api/events/node', (req, res) => { const id = String(req.query.id || ''), tree = data.operationTree;
    if (!tree || tree.error || !tree.nodes.some(n => n.id === id)) return res.status(404).json({ error: 'No such operation tree node' });
    const nodes = new Map(tree.nodes.map(n => [n.id, n])), ids = new Set([id]); let changed = true;
    while (changed) { changed = false; for (const n of tree.nodes) if (n.parent && ids.has(n.parent) && !ids.has(n.id)) { ids.add(n.id); changed = true; } }
    if (id === 'unfiled') return send(res, { id, events: data.events.filter(e => !operationPlacement(e.operation, tree.nodes)).map(meta) });
    send(res, { id, events: data.events.filter(e => { const placed = operationPlacement(e.operation, tree.nodes); return !!placed && ids.has(placed); }).map(meta) });
  });
  app.get('/api/artifacts', (req, res) => { const op = String(req.query.op || ''), g = String(req.query.group || '');
    send(res, visibleDocuments(data.artifacts, data.allow).filter(a => (!op || op === '*' || a.operation === op || a.operation?.startsWith(op + '/')) && (!g || a.group === g)).slice(0, 2000)); });
  // Default Expand: agent prose is replaced by a stub. It is served only by the explicit third-click route below.
  app.get('/api/expand/event/:id', (req, res) => { const e = data.byId.get(req.params.id); if (!e) return res.status(404).json({ error: 'No such event' }); const x = expandEvent(data, e); send(res, { event: meta(e), ...x, sections: hideProse(x.sections) }); });
  app.get('/api/expand/event/:id/prose', (req, res) => { const e = data.byId.get(req.params.id); if (!e) return res.status(404).json({ error: 'No such event' }); const x = expandEvent(data, e); send(res, { id: e.id, source: x.source, sections: onlyProse(x.sections) }); });
  app.get('/api/expand/file', (req, res) => { const p = String(req.query.path || ''); if (!p) return res.status(400).json({ error: 'path required' });
    // a driver's own records map rooms to arms: path only until the operation has a valid unmask record
    const c = data.allow.canonical(p), op = opFolderOf(data.allow, c);
    if (deniedDocument(c, data.allow)) return send(res, { path: c, allowed: false, note: 'withheld by Office document policy' });
    if (op && /^(manifest-[\w-]+\.jsonl|driver-state\.json|checkpoints\.json)$/i.test(path.basename(c)) && maskerFor(data.allow, op.dir, op.id).masked) return send(res, { path: c, allowed: false, note: 'masked until a valid unmask record (it maps rooms to arms)' });
    send(res, data.allow.read(p)); });
  // ---- O3: workflow graph, experiment fans, archive (metadata tier: ids, names, counts, outcomes; no content) ----------
  const opDirOf = (op: string) => /^\d{4}-\d\d-\d\d\/\w[\w.-]*(\/|$)/.test(op) ? path.join(data.allow.roots.coordination, op.split('/').slice(0, 2).join('/')) : /^work\/\w[\w.-]*(\/|$)/.test(op) ? path.join(data.allow.roots.work, op.split('/')[1]) : '';
  app.get('/api/workflow', (req, res) => { const op = String(req.query.op || ''); const w = !op ? null : op === '*' ? { op, template: null, rounds: [], unplanned: [], roleLoops: roleLoops(data, '*') } : matchWorkflow(data, op); send(res, { workflow: w, stepNames: stepNames() }); });
  app.get('/api/rooms', (req, res) => { const op = String(req.query.op || ''), dir = opDirOf(op); send(res, { op, runs: dir ? fans(data.allow, data.events, dir, op.split('/').slice(0, 2).join('/')) : [] }); });
  app.get('/api/archive', (req, res) => {
    const op = String(req.query.op || ''), q = String(req.query.q || '').toLowerCase(), titles = new Map<string, string>(), by = new Map<string, OfficeEvent[]>();
    for (const e of data.events) if (e.target?.kind === 'file' && e.target.path && (e.verb === 'write' || e.verb === 'read')) (by.get(e.target.path) || by.set(e.target.path, []).get(e.target.path)!).push(e);
    const ref = (e: OfficeEvent) => ({ id: e.id, ts: e.ts, actor: e.actor.name || e.actor.label, provenance: e.provenance });
    const items = visibleDocuments(data.artifacts, data.allow).filter(a => !op || op === '*' || a.operation === op || a.operation?.startsWith(op + '/')).map(a => {
      const evs = by.get(a.path) || [], w = evs.find(e => e.verb === 'write'), readers = evs.filter(e => e.verb === 'read' && e !== w);
      return { path: a.path, title: fileTitle(a.path, data.allow, titles), group: a.group, mtime: a.mtime, operation: a.operation, size: a.size, writer: w ? ref(w) : null, readers: readers.slice(-20).map(ref), readerCount: readers.length };
    }).filter(a => !q || a.title.toLowerCase().includes(q)).sort((a, b) => (a.operation || '').localeCompare(b.operation || '') || a.mtime.localeCompare(b.mtime));
    // work/<thing>: the README's **Status** line, shown with the operation in the archive
    const status = Object.fromEntries([...new Set(items.map(a => a.operation).filter((o): o is string => !!o && /^work\/[^/]+$/.test(o)))].map(o => [o, workStatus(o, data.allow)]).filter(([, v]) => v));
    send(res, { op, items: items.slice(0, 3000), now: new Date().toISOString(), status });
  });
  app.get('/api/node/documents', (req, res) => {
    const id = String(req.query.id || ''), tree = data.operationTree;
    if (!tree || tree.error || !tree.nodes.some(n => n.id === id)) return res.status(404).json({ error: 'No such operation tree node' });
    send(res, { id, items: nodeDocuments(id, tree.nodes, data.artifacts, data.allow) });
  });
  app.get('/api/recollect', (_req, res) => { live.full(); send(res, { collectedAt: data.collectedAt, events: data.events.length }); });
  // Server-sent events: upserts/removals as the live tier merges them. Same metadata tier and redaction as /api/events.
  app.get('/api/live', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const push = (type: string, v: unknown) => (refreshBlind(data.allow), res.write(`event: ${type}\ndata: ${JSON.stringify(redactDeep(maskDeep(data.allow)(v)))}\n\n`));
    push('hello', { version: live.version, collectedAt: data.collectedAt });
    live.clients.add(push);
    const beat = setInterval(() => res.write(': beat\n\n'), 15000); beat.unref();
    req.on('close', () => { clearInterval(beat); live.clients.delete(push); });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(express.static(path.join(__dirname, 'web'), { etag: false, setHeaders: (res, p) => { res.setHeader('Cache-Control', 'no-cache'); if (p.endsWith('.mjs')) res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); } }));
  app.use((err: any, _req: any, res: any, _next: any) => res.status(500).json({ error: redact(String(err?.message || err)) }));
  return { app, live, get data() { return data; } };
}

if (require.main === module) {
  const live = process.env.OFFICE_LIVE !== '0', port = Number(process.env.OFFICE_PORT || 4318), t = Date.now();
  const { app, data, live: tier } = createOffice(config(), live ? { tickMs: 1000, fullMs: Number(process.env.OFFICE_FULL_MS || 15000), roomFeed: process.env.OFFICE_ROOM_FEED || undefined } : {});
  tier.start();
  app.listen(port, '127.0.0.1', () => console.log(`Office on http://127.0.0.1:${port} (${data.events.length} events, ${data.operations.length} operations, collected in ${Date.now() - t}ms, live ${live ? 'on' : 'off'})`));
}
