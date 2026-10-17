import express from 'express';
import path from 'node:path';
import { collect, type Collected } from './collect/index';
import { config, redact, redactDeep, type Config } from './collect/privacy';
import { expandEvent } from './collect/expand';
import type { OfficeEvent } from './collect/types';

// The Office: read-only, loopback-only view over saved records. GET routes only; nothing here writes to any source.
const meta = (e: OfficeEvent) => { const { hints, ...m } = e; return m; }; // hints carry command/prompt text: never in the summary tier
const inOp = (e: OfficeEvent, op?: string) => !op || op === '*' || e.operation === op || !!e.operation?.startsWith(op + '/');

export function createOffice(cfg: Config = config()) {
  let data: Collected = collect(cfg);
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
  app.get('/api/recollect', (_req, res) => { data = collect(cfg); send(res, { collectedAt: data.collectedAt, events: data.events.length }); });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(express.static(path.join(__dirname, 'web'), { etag: false, setHeaders: (res, p) => { res.setHeader('Cache-Control', 'no-cache'); if (p.endsWith('.mjs')) res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); } }));
  app.use((err: any, _req: any, res: any, _next: any) => res.status(500).json({ error: redact(String(err?.message || err)) }));
  return { app, get data() { return data; } };
}

if (require.main === module) {
  const port = Number(process.env.OFFICE_PORT || 4318), t = Date.now(), { app, data } = createOffice();
  app.listen(port, '127.0.0.1', () => console.log(`Office on http://127.0.0.1:${port} (${data.events.length} events, ${data.operations.length} operations, collected in ${Date.now() - t}ms)`));
}
