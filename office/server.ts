import express from 'express';
import path from 'node:path';
import { collect, type Collected } from './collect/index';
import { config, redact, redactDeep, type Config } from './collect/privacy';
import { expandEvent } from './collect/expand';
import type { OfficeEvent } from './collect/types';
import { Live, type LiveOpts } from './live';

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
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  const send = (res: any, v: unknown) => res.json(redactDeep(v)); // last line of defence: every API string passes redaction
  app.get('/api/summary', (_req, res) => send(res, {
    collectedAt: data.collectedAt, operations: data.operations, actors: [...data.actors.values()],
    sources: data.sources.map(s => ({ ...s })), counts: { events: data.events.length, artifacts: data.artifacts.length },
  }));
  app.get('/api/events', (req, res) => { const op = String(req.query.op || ''); send(res, { op, events: data.events.filter(e => inOp(e, op)).map(meta) }); });
  app.get('/api/artifacts', (req, res) => { const op = String(req.query.op || ''), g = String(req.query.group || '');
    send(res, data.artifacts.filter(a => (!op || op === '*' || a.operation === op || a.operation?.startsWith(op + '/')) && (!g || a.group === g)).slice(0, 2000)); });
  app.get('/api/expand/event/:id', (req, res) => { const e = data.byId.get(req.params.id); if (!e) return res.status(404).json({ error: 'No such event' }); send(res, { event: meta(e), ...expandEvent(data, e) }); });
  app.get('/api/expand/file', (req, res) => { const p = String(req.query.path || ''); if (!p) return res.status(400).json({ error: 'path required' }); send(res, data.allow.read(p)); });
  app.get('/api/recollect', (_req, res) => { live.full(); send(res, { collectedAt: data.collectedAt, events: data.events.length }); });
  // Server-sent events: upserts/removals as the live tier merges them. Same metadata tier and redaction as /api/events.
  app.get('/api/live', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const push = (type: string, v: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify(redactDeep(v))}\n\n`);
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
