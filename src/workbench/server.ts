import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { Engine, initialState, type Revision } from './engine';
import { defaultStore, reasoningOf, demoEnabled } from './generation';
import { id } from './store';
import { Comparisons } from './comparisons';
import { Experiments } from './experiments';
import { stateChanges } from './changes';

function runInfo(run: any) {
  if (run == null) return undefined;
  const { id, index, count, mode } = run;
  if (typeof id !== 'string' || !id || !Number.isInteger(index) || !Number.isInteger(count) || index < 1 || index > count || count > 20 || ![undefined,'alternate'].includes(mode))
    throw Error('Invalid run');
  return { id, index, count, ...(mode ? { mode } : {}) };
}

export function createApp(engine = new Engine(defaultStore())) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const host = req.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return res.status(403).json({ error: 'Local connections only' });
    if (req.headers.origin && req.headers.origin !== `http://${host}`) return res.status(403).json({ error: 'Cross-origin requests are not allowed' });
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control','no-store');
    next();
  });
  app.use(express.json({ limit: '8mb' }));
  const route = (fn: (req: any, res: any) => any) => (req: any, res: any, next: any) => Promise.resolve().then(() => fn(req,res)).catch(next);
  const store = engine.store;
  const comparisons = new Comparisons(engine);
  const experiments = new Experiments(engine);
  app.locals.experiments = experiments;
  const changes = (key: string) => { const b=engine.read(key); const fork=b.fork?store.get<Revision>('revisions',b.fork):null; return {fork:fork?{branch:fork.branch,revision:fork.id}:null,changes:fork?stateChanges(fork.state,b.revision.state):null}; };
  const evidence = (branch: string) => {
    const b = engine.read(branch);
    const revisions: Revision[] = []; let cursor: string | null = b.head;
    while (cursor) { const rev: Revision = store.get<Revision>('revisions', cursor); revisions.push(rev); cursor = rev.parent; }
    const ids = new Set(revisions.map(r => r.id));
    const relevant = (r: any) => r.branch === branch || ids.has(r.revision);
    const jevResults = new Map(store.list('jev-results').map(r => [r.id,r]));
    return { branch: b, revisions, changes: changes(branch), attempts: store.attempts().filter(relevant).map(a=>({...a,reasoning:reasoningOf(a.outcome)})), selections: store.list('selections').filter(relevant),
      turns: store.list('turns').filter(r => r.branch === branch),
      reactions: (() => { const messages = new Set(revisions.flatMap(r => r.state.messages.map(m => m.id))); return store.list('reactions').filter(r => messages.has(r.message)).sort((a,b)=>a.message.localeCompare(b.message)||a.sequence-b.sequence); })(),
      imports: store.list('imports').filter(relevant),
      observations: store.list('observations').filter(r => r.branch === branch), edits: store.list('edits').filter(r => r.branch === branch),
      jev: store.list('jev-requests').filter(relevant).map(r => ({ ...r, outcome: jevResults.get(r.id) || null })) };
  };
  app.get('/api/bootstrap', route((_req,res) => {
    const saved = comparisons.list(), library = engine.library();
    const trials = experiments.trialBranches();
    res.json({ ...library, branches: library.branches.map(b => trials.has(b.id) ? { ...b, isTrial: true } : b), comparisons: saved, experiments: experiments.list(), reactions: reactions(),
      keys: { opengateway: !!process.env.OPENGATEWAY_API_KEY, together: !!process.env.TOGETHER_API_KEY, jev: !!process.env.TYPESAFE_API_KEY, demo: demoEnabled() },
      active: [...engine.active.keys()] });
  }));
  app.get('/api/branches/:id/changes', route((req,res) => res.json(changes(req.params.id))));
  app.post('/api/changes', route((req,res) => res.json(stateChanges(engine.read(req.body.left).revision.state,engine.read(req.body.right).revision.state))));
  // Append-only research marks; the latest per message wins. Never part of model context.
  function reactions() {
    const latest: Record<string, any> = {};
    for (const r of store.list('reactions').sort((a,b)=>a.sequence-b.sequence)) latest[r.message] = r;
    return Object.fromEntries(Object.entries(latest).filter(([,r])=>r.value).map(([k,r])=>[k,r.value]));
  }
  // Marked replies with their text as first recorded, for the Favorites/Dislikes library and export.
  function marked(value: string) {
    const current = reactions(), wanted = Object.entries(current).filter(([,v])=>v===value).map(([k])=>k);
    const found = new Map<string, { message: any; revision: Revision }>();
    for (const rev of store.list<Revision>('revisions').sort((a,b)=>a.at.localeCompare(b.at))) for (const m of rev.state.messages) if (wanted.includes(m.id) && !found.has(m.id)) found.set(m.id, { message: m, revision: rev });
    const history = store.list('reactions'), branches = new Map(store.list('branches').map(b=>[b.id,b]));
    return wanted.map(key => {
      const records = history.filter(r=>r.message===key).sort((a,b)=>a.sequence-b.sequence), last = records.at(-1), f = found.get(key);
      return { message: key, value, at: last.at, branch: last.branch, branchName: branches.get(last.branch)?.name ?? null, speaker: f?.message.speaker ?? null, text: f?.message.text ?? null, source: f?.message.source ?? null, turnId: f?.message.turnId ?? last.turnId, history: records };
    }).sort((a,b)=>b.at.localeCompare(a.at));
  }
  app.get('/api/reactions/:value', route((req,res) => { if (!['favorite','dislike'].includes(req.params.value)) throw Error('Invalid reaction'); res.json(marked(req.params.value)); }));
  app.get('/api/reactions/:value/export', route((req,res) => { if (!['favorite','dislike'].includes(req.params.value)) throw Error('Invalid reaction'); res.attachment(`room-${req.params.value}s.json`).json({ format: 'room-reactions-v1', value: req.params.value, exportedAt: new Date().toISOString(), items: marked(req.params.value).map(m => ({ ...m, attempts: store.attempts().filter(a => a.turnId && a.turnId === m.turnId).map(a=>({...a,reasoning:reasoningOf(a.outcome)})) })) }); }));
  app.post('/api/reactions', route((req,res) => {
    const { branch, message, value } = req.body;
    if (![null,'favorite','dislike'].includes(value)) throw Error('Invalid reaction');
    const m = engine.read(branch).revision.state.messages.find(m=>m.id===message);
    if (!m) throw Error('That message is not in this conversation');
    const previous = store.list('reactions').filter(r=>r.message===message);
    store.add('reactions', { id: id(), message, branch, turnId: m.turnId ?? null, value, at: new Date().toISOString(), sequence: previous.length + 1 });
    res.json(reactions());
  }));
  app.get('/api/experiments', route((_req,res) => res.json(experiments.list())));
  app.post('/api/experiments', route((req,res) => res.json(experiments.create(req.body))));
  app.get('/api/experiments/:id', route((req,res) => res.json(experiments.detail(req.params.id))));
  app.post('/api/experiments/:id/edit', route((req,res) => res.json(experiments.edit(req.params.id,req.body))));
  app.post('/api/experiments/:id/attach', route((req,res) => res.json(experiments.attach(req.params.id,req.body))));
  app.post('/api/experiments/:id/run', route((req,res) => res.json(experiments.run(req.params.id,req.body.perCondition,req.body.expected))));
  app.post('/api/experiments/:id/branch', route((req,res) => res.json(experiments.branch(req.params.id,req.body))));
  app.post('/api/experiments/:id/link', route((req,res) => res.json(experiments.link(req.params.id,req.body))));
  app.post('/api/experiments/:id/stop', route((req,res) => res.json(experiments.stop(req.params.id))));
  app.post('/api/experiments/:id/labels', route((req,res) => res.json(experiments.label(req.params.id,req.body.trial,req.body))));
  app.post('/api/experiments/:id/observations', route((req,res) => {
    experiments.get(req.params.id);
    if(typeof req.body.text!=='string'||!req.body.text.trim())throw Error('Write an observation first');
    const value={id:id(),experiment:req.params.id,at:new Date().toISOString(),text:req.body.text.slice(0,20000)};
    store.add('observations',value);res.json(value);
  }));
  app.post('/api/branches/:id/trash', route((req,res) => res.json(engine.trash(req.params.id,req.body.expected))));
  app.post('/api/trash/:id/restore', route((req,res) => res.json(engine.restore(req.params.id))));
  app.get('/api/comparisons/:id', route((req,res) => res.json(comparisons.get(req.params.id))));
  app.post('/api/comparisons/draft', route((req,res) => res.json(comparisons.save({name:'Unsaved comparison',left:req.body.left,right:req.body.right},null,true))));
  app.post('/api/comparisons', route((req,res) => res.json(comparisons.save(req.body))));
  app.post('/api/comparisons/:id/fork', route((req,res) => res.json(comparisons.fork(req.params.id,req.body.name,req.body.expected))));
  app.post('/api/branches', route((req,res) => res.json(engine.create(String(req.body.name || 'New room')))));
  app.get('/api/branches/:id', route((req,res) => res.json({ ...evidence(req.params.id), active: engine.active.has(req.params.id) })));
  app.post('/api/branches/:id/settings', route((req,res) => {
    const b = engine.read(req.params.id); const s = b.revision.state;
    // Conversation edits go through the explicit retcon operation.
    const { system, human, participants, characters, shadow, policy } = req.body;
    res.json(engine.commit(b.id, req.body.expected, { ...s, system, human, participants, characters, shadow, policy }, 'Settings updated'));
  }));
  app.post('/api/branches/:id/messages', route((req,res) => res.json(engine.message(req.params.id, req.body.expected, req.body.text || ''))));
  app.post('/api/branches/:id/messages/:message/delete', route((req,res) => res.json(engine.deleteMessage(req.params.id,req.body.expected,req.params.message))));
  app.post('/api/branches/:id/messages/restore', route((req,res) => res.json(engine.restoreMessage(req.params.id,req.body.expected,req.body.deletion))));
  app.post('/api/branches/:id/turn', route(async(req,res) => res.json(await engine.turn(req.params.id, req.body.expected, req.body.speaker || undefined, runInfo(req.body.run)))));
  app.post('/api/branches/:id/stop', route((req,res) => { engine.cancel(req.params.id); res.json({ ok: true }); }));
  app.post('/api/branches/:id/fork', route((req,res) => res.json(engine.fork(req.params.id, req.body.revision, String(req.body.name || 'Alternate continuation'), req.body.messageId))));
  app.post('/api/branches/:id/retcon', route((req,res) => res.json(engine.retcon(req.params.id, req.body.expected, req.body.messageId, String(req.body.text ?? ''), req.body.mode, req.body.memory))));
  app.post('/api/branches/:id/history', route((req,res) => {
    const b = engine.read(req.params.id);
    if (b.head !== req.body.expected) throw Error('Branch changed; reload before retconning');
    if (!Array.isArray(req.body.messages) || !['keep','clear'].includes(req.body.memory)) throw Error('Invalid history retcon');
    const state = structuredClone(b.revision.state);
    const originals = new Map(state.messages.map(m => [m.id,m]));
    state.messages = req.body.messages.map((m: any) => {
      const old = originals.get(m.id);
      if (old && old.text === m.text && old.speaker === m.speaker) return old;
      return { id: id(), speaker: m.speaker, text: m.text, source: 'edited', ...(old ? {editedFrom:[old.id,...(old.editedFrom||[])],turnId:old.turnId} : {}) };
    });
    if (req.body.memory === 'clear') for (const c of Object.values(state.characters)) c.memory = '';
    const result = engine.create(b.name + ' · history retcon', state, b.id, b.head);
    store.add('edits', { branch:result.id, sourceRevision:b.head, kind:'history', memory:req.body.memory, at:new Date().toISOString() });
    res.json(result);
  }));
  app.post('/api/branches/:id/observations', route((req,res) => {
    const b = engine.read(req.params.id);
    if (typeof req.body.text !== 'string' || !req.body.text.trim()) throw Error('Write an observation first');
    const observation = { id: id(), branch: b.id, revision: b.head, at: new Date().toISOString(), text: req.body.text.slice(0,20000), messageId: req.body.messageId || null };
    store.add('observations',observation); res.json(observation);
  }));
  app.get('/api/branches/:id/export', route((req,res) => res.attachment('room-research.json').json({ format: 'room-workbench-v1', ...evidence(req.params.id) })));
  app.get('/api/branches/:id/notebook', route((req,res) => {
    const e = evidence(req.params.id);
    res.type('text/markdown').attachment('room-notes.md').send(`# ${e.branch.name}\n\n` + e.observations.map(o => `## ${o.at}\n\nBranch: ${o.branch}\nRevision: ${o.revision}\nMessage: ${o.messageId || '(whole branch)'}\n\n${o.text}`).join('\n\n'));
  }));
  app.post('/api/import', route((req,res) => {
    const snap = req.body;
    if (!Array.isArray(snap.history) || !snap.history.every((s: any) => typeof s === 'string')) throw Error('Import a legacy room save with a history array');
    const s = initialState();
    s.messages = snap.history.map((line: string) => {
      const split = line.indexOf(':');
      return { id: id(), speaker: split > 0 ? line.slice(0,split) : 'Unknown', text: split > 0 ? line.slice(split+1).trim() : line, source: 'imported' };
    });
    if (snap.participants) s.participants = snap.participants;
    for (const [name,c] of Object.entries(s.characters)) {
      if (typeof snap.personaOverrides?.[name] === 'string') c.prompt = snap.personaOverrides[name];
      if (Array.isArray(snap.personaMemory?.[name])) c.memory = snap.personaMemory[name].join('\n');
      if (snap.assignments?.[name] === 'kimi') { c.provider = 'opengateway'; c.model = 'moonshotai/kimi-k3-ultrafast'; }
    }
    const b = engine.create(String(snap.id || 'Imported conversation'), s);
    store.put('imports', b.id, { id: b.id, branch: b.id, at: new Date().toISOString(), original: snap,
      unknown: ['exact historical prompts','raw attempts','selection methods','intermediate memory'], warning: 'Current default persona prompts substitute for missing historical prompts; historical settings are not reconstructed.' });
    res.json(b);
  }));
  app.use(express.static(path.resolve(__dirname, '../../web')));
  app.use((err: any,_req: any,res: any,_next: any) => res.status(err.code === 'ENOENT' ? 404 : 400).json({ error: err.message || 'Request failed' }));
  return app;
}
if (require.main === module) {
  const store = defaultStore();
  const port = Number(process.env.ROOM_PORT || 4317);
  const app = createApp(new Engine(store));
  const server = app.listen(port, '127.0.0.1', () => {
    // Only recover browser requests after successfully acquiring the listening port.
    // Discord uses the same attempt store but owns its own in-flight requests.
    for (const attempt of store.attempts()) if (attempt.branch && !attempt.outcome) store.put('outcomes', attempt.id, { id: attempt.id, status: 'interrupted', error: 'Process ended before an outcome was recorded' });
    const done = new Set(store.list('jev-results').map(r => r.id));
    for (const r of store.list('jev-requests')) if (!done.has(r.id)) store.put('jev-results',r.id,{ id:r.id,status:'interrupted',error:'Process ended before a result was recorded' });
    app.locals.experiments.recover();
    console.log(`Room workbench: http://127.0.0.1:${port}`);
  });
  server.on('error', err => { console.error(err.message); process.exitCode = 1; });
}
