import express from 'express';
import { appendBoard, appendBoardInternal, pageBoard, readBoard, roomOf, visibleMessage, BoardError } from './board';
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
import { readRegistry } from './collect/roles';
import { buildForkPrompt, cleanForkReply, ForkFailure, runnerFromEnv, weightedUsage, type ForkRunner } from './fork';
import fs from 'node:fs';

// The Office is loopback-only. The board POSTs are its only write routes.
const meta = (e: OfficeEvent) => { const { hints, ...m } = e; return m; }; // hints carry command/prompt text: never in the summary tier
const inOp = (e: OfficeEvent, op?: string) => !op || op === '*' || e.operation === op || !!e.operation?.startsWith(op + '/');

type ForkRecord = { id: string; at: string; role: string; session: string; triggerId: string; status: 'started'|'ok'|'failed'|'timeout'|'withheld'; usage?: { input: number; output: number; cacheRead: number; cacheWrite: number }; model?: string | null; weighted?: number; error?: string };
const statePath = (cfg: Config) => path.join(cfg.board || path.join(cfg.room || path.join(cfg.home, 'dev/room'), 'board'), 'leisure-state.json');
const forksPath = (cfg: Config) => path.join(cfg.board || path.join(cfg.room || path.join(cfg.home, 'dev/room'), 'board'), 'forks.jsonl');
function leisureState(cfg: Config) { try { const s = JSON.parse(fs.readFileSync(statePath(cfg), 'utf8')); if (typeof s.enabled !== 'boolean') throw 0; return { enabled: s.enabled, cap: 20 }; } catch { return { enabled: false, cap: 20 }; } }
function forkRecords(cfg: Config): ForkRecord[] { let text: string; try { text = fs.readFileSync(forksPath(cfg), 'utf8'); } catch (e:any) { if (e.code === 'ENOENT') return []; throw e; } return text.split('\n').filter(Boolean).map(x => { const r=JSON.parse(x); if (!r || typeof r.id!=='string' || typeof r.at!=='string' || !Number.isFinite(Date.parse(r.at)) || !['started','ok','failed','timeout','withheld'].includes(r.status)) throw new Error('invalid fork record'); return r; }); }
const localDay = (s: string) => { const d = new Date(s); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
function writeForkRecord(cfg: Config, record: ForkRecord) { const p = forksPath(cfg); fs.mkdirSync(path.dirname(p), { recursive: true }); const fd=fs.openSync(p,fs.constants.O_CREAT|fs.constants.O_WRONLY|fs.constants.O_APPEND|fs.constants.O_NOFOLLOW,0o600); try { const line=Buffer.from(JSON.stringify(record)+'\n'); if(fs.writeSync(fd,line)!==line.length) throw new Error('incomplete fork record'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
class ForkLockUnavailable extends Error {}
function withForkLock<T>(cfg: Config, fn:()=>T): T { const dir=path.dirname(forksPath(cfg)), lock=path.join(dir,'forks.lock'); fs.mkdirSync(dir,{recursive:true}); for(let i=0;;i++){ try { fs.mkdirSync(lock); break; } catch(e:any) { if(e.code!=='EEXIST') throw e; if(i>=249) throw new ForkLockUnavailable('fork lock unavailable'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20); } } try { return fn(); } finally { fs.rmdirSync(lock); } }
function sessionFor(cfg: Config, role: string) { const registry = readRegistry(cfg.sessions); if (registry.error || registry.skipped) return undefined; const es = registry.entries.filter(e => e.role === role && e.since <= new Date().toISOString()); return es.at(-1)?.session; }
export const isHumanForkTrigger = (trigger: import('./board').Message) => trigger.author.kind === 'human' && trigger.author.role === 'deniz';
const requestId = () => `f-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;

export function createOffice(cfg: Config = config(), liveOpts?: LiveOpts, forkRunner: ForkRunner = runnerFromEnv(process.env, cfg.room || path.join(cfg.home,'dev/room'))) {
  let data: Collected = collect(cfg);
  const live = new Live(() => data, d => { data = d; }, cfg, liveOpts || {});
  const app = express();
  app.disable('x-powered-by'); app.disable('etag');
  app.use((req, res, next) => {
    const started = performance.now();
    res.on('finish', () => { if (req.path.startsWith('/api/')) console.info('[office timing]', req.path, Math.round(performance.now()-started), 'ms'); });
    const host = req.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return res.status(403).json({ error: 'Local connections only' });
    if (req.method !== 'GET' && req.method !== 'HEAD' && !(req.method === 'POST' && (/^\/api\/board\/[^/]+$/.test(req.path) || req.path === '/api/board/leisure/state'))) return res.status(405).set('Allow', 'GET, HEAD').json({ error: 'The Office is read-only.' });
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.path.startsWith('/api/')) { res.setHeader('Cache-Control', 'no-store'); refreshBlind(data.allow); } // fail closed: index any new masked folder before answering
    next();
  });
  // last line of defence: every API string passes redaction, and trajectory ids of masked operations are masked
  const send = (res: any, v: unknown) => res.json(redactDeep(maskDeep(data.allow)(v)));
  const stateView = () => {
    const state = leisureState(cfg), today = localDay(new Date().toISOString()), records = forkRecords(cfg);
    const terminal = new Set(records.filter(r => r.status !== 'started').map(r => r.id));
    const usedToday = records.filter(r => r.status === 'started' && localDay(r.at) === today).length;
    const unknownToday = records.filter(r => r.status === 'started' && localDay(r.at) === today && !terminal.has(r.id)).length;
    const successful = records.filter(r => r.status === 'ok' && r.weighted !== undefined);
    return { ...state, usedToday, unknownToday, avgWeighted: successful.length ? Math.round(successful.reduce((n,r) => n + (r.weighted || 0),0)/successful.length) : null };
  };
  app.get('/api/board/leisure/state', (_req,res) => send(res, stateView()));
  app.post('/api/board/leisure/state', (req,res,next) => {
    if (req.headers.origin !== `http://${req.headers.host}` || Number(req.headers.host?.split(':')[1] || 80) !== req.socket.localPort) return res.status(403).json({ error: 'Office same-origin required' });
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return res.status(415).json({ error: 'JSON content-type required' });
    next();
  }, express.json({ limit: 1024, inflate: false }), (req,res) => {
    if (!req.body || typeof req.body.enabled !== 'boolean' || Object.keys(req.body).some(k => k !== 'enabled')) return res.status(400).json({ error: 'Only enabled is accepted' });
    const old = leisureState(cfg), p = statePath(cfg), temp = `${p}.${process.pid}.tmp`; fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(temp, JSON.stringify({ enabled: req.body.enabled, cap: old.cap })+'\n', { mode: 0o600 }); fs.renameSync(temp,p); send(res,stateView());
  });
  let forkQueue = Promise.resolve();
  const queueForks = (trigger: import('./board').Message) => {
    if (!isHumanForkTrigger(trigger)) return;
    for (const role of [...new Set(trigger.mentions)]) forkQueue = forkQueue.then(async () => {
      const notice = (text: string) => appendBoardInternal(cfg,'leisure',text,{ role:'office',kind:'notice' },trigger.id);
      const state = leisureState(cfg);
      if (!state.enabled) { notice('leisure is off'); return; }
      const session = sessionFor(cfg,role);
      if (!session) { notice(`${role} has no registered session`); return; }
      const at = new Date().toISOString(), today = localDay(at); let records: ForkRecord[];
      const id = requestId(); let used=0, admitted=false, readFailure=false, lockFailure=false;
      try { withForkLock(cfg,()=>{ records=forkRecords(cfg); used=records.filter(r=>r.status==='started'&&localDay(r.at)===today).length; if(used<state.cap){writeForkRecord(cfg,{id,at,role,session,triggerId:trigger.id,status:'started'}); admitted=true;} }); }
      catch(e) { lockFailure=e instanceof ForkLockUnavailable; readFailure=!lockFailure; }
      if(lockFailure){notice('fork lock unavailable, leisure forks paused');return;}
      if(readFailure){notice('fork records unreadable, leisure forks paused');return;}
      if(!admitted){notice(`fork cap reached (${used}/${state.cap} today)`);return;}
      try {
        const history = readBoard(cfg,'leisure'), prompt = buildForkPrompt(cfg,role,history,trigger,at);
        const result = await forkRunner({ sessionId:session,prompt,timeoutMs:120_000 });
        const cleaned = cleanForkReply(result.text,data.allow);
        if (cleaned.withheld) { writeForkRecord(cfg,{id,at,role,session,triggerId:trigger.id,status:'withheld',usage:result.usage,model:result.model,weighted:weightedUsage(result.usage)}); notice('reply withheld by the deny-list'); return; }
        if (!cleaned.text) throw new ForkFailure('empty or oversized fork reply');
        appendBoardInternal(cfg,'leisure',cleaned.text,{role,kind:'standin'},trigger.id);
        writeForkRecord(cfg,{id,at,role,session,triggerId:trigger.id,status:'ok',usage:result.usage,model:result.model,weighted:weightedUsage(result.usage)});
      } catch (e:any) {
        const timeout = e instanceof ForkFailure && e.timeout;
        const safe = redact(String(e?.message || 'fork failed')).slice(0,500);
        writeForkRecord(cfg,{id,at,role,session,triggerId:trigger.id,status:timeout?'timeout':'failed',error:safe});
        notice(timeout ? 'fork timed out' : 'fork failed');
      }
    }).catch(() => {});
  };
  app.get('/api/board/:room', (req, res) => {
    try { const room = roomOf(req.params.room); send(res, { messages: pageBoard(cfg, room, req.query.after === undefined ? undefined : String(req.query.after), req.query.limit === undefined ? 100 : Number(req.query.limit)).map(m => visibleMessage(m, data.allow)) }); }
    catch (e) { const err = e as BoardError; res.status(err.status || 503).json({ error: err instanceof BoardError ? err.message : 'Board unavailable' }); }
  });
  let posts: number[] = [];
  app.post('/api/board/:room', (req, res, next) => {
    if (req.headers.origin !== `http://${req.headers.host}` || Number(req.headers.host?.split(':')[1] || 80) !== req.socket.localPort) return res.status(403).json({ error: 'Office same-origin required' });
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return res.status(415).json({ error: 'JSON content-type required' });
    try { roomOf(req.params.room); } catch { return res.status(404).json({ error: 'Unknown board room' }); }
    const now = Date.now(); posts = posts.filter(t => now - t < 60000);
    if (posts.length >= 30) return res.status(429).set('Retry-After', '60').json({ error: 'Board rate limit: 30/minute' });
    posts.push(now); next();
  }, express.json({ limit: 16384, inflate: false }), (req, res) => {
    try { const message = appendBoard(cfg, roomOf(req.params.room), req.body, { role: 'deniz', kind: 'human' }); res.status(201); send(res, { message: visibleMessage(message, data.allow) }); if (message.room === 'leisure' && message.mentions.length) queueMicrotask(() => queueForks(message)); }
    catch (e) { const err = e as BoardError; res.status(err.status || 503).json({ error: err instanceof BoardError ? err.message : 'Board unavailable' }); }
  });
  app.get('/api/summary', (_req, res) => send(res, {
    collectedAt: data.collectedAt, operations: data.operations, ...(data.operationTree ? { operationTree: data.operationTree } : {}), ...(data.tokenRecords ? { tokenRecords: data.tokenRecords } : {}), actors: [...data.actors.values()],
    sources: data.sources.map(s => ({ ...s })), counts: { events: data.events.length, artifacts: visibleDocuments(data.artifacts, data.allow).length },
  }));
  app.get('/api/events', (req, res) => { const op = String(req.query.op || ''); send(res, { op, events: data.events.filter(e => inOp(e, op)).map(meta) }); });
  app.get('/api/events/node', (req, res) => { const id = String(req.query.id || ''), tree = data.operationTree;
    if (!tree || tree.error || !tree.nodes.some(n => n.id === id)) return res.status(404).json({ error: 'No such operation tree node' });
    send(res, { id, events: (data.eventNodeIndex?.get(id) || []).map(meta) });
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
    // a tree node id: same placement as the graph's counts and documents (node + descendants; 'unfiled' = unplaced)
    const tn = data.operationTree?.nodes, inNode = tn?.some(n => n.id === op) ? (() => { const ids = new Set([op]); for (let ch = true; ch;) { ch = false; for (const n of tn!) if (n.parent && ids.has(n.parent) && !ids.has(n.id)) { ids.add(n.id); ch = true; } } return (o?: string) => { const pl = operationPlacement(o, tn as any); return op === 'unfiled' ? !pl : ids.has(pl || ''); }; })() : null;
    const items = visibleDocuments(data.artifacts, data.allow).filter(a => inNode ? inNode(a.operation) : (!op || op === '*' || a.operation === op || a.operation?.startsWith(op + '/'))).map(a => {
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
  app.get('/api/recollect', (_req, res) => { void live.full(); send(res, { collectedAt: data.collectedAt, events: data.events.length }); });
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
  app.use((err: any, req: any, res: any, _next: any) => req.path.startsWith('/api/board/') ? res.status(err.status === 413 ? 413 : err.status === 415 ? 415 : 400).json({ error: 'Invalid board request' }) : res.status(500).json({ error: redact(String(err?.message || err)) }));
  return { app, live, get data() { return data; }, drainForks: () => forkQueue };
}

if (require.main === module) {
  const live = process.env.OFFICE_LIVE !== '0', port = Number(process.env.OFFICE_PORT || 4318), t = Date.now();
  const { app, data, live: tier } = createOffice(config(), live ? { tickMs: 1000, fullMs: Number(process.env.OFFICE_FULL_MS || 15000), roomFeed: process.env.OFFICE_ROOM_FEED || undefined } : {});
  tier.start();
  app.listen(port, '127.0.0.1', () => console.log(`Office on http://127.0.0.1:${port} (${data.events.length} events, ${data.operations.length} operations, collected in ${Date.now() - t}ms, live ${live ? 'on' : 'off'})`));
}
