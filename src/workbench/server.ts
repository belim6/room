import 'dotenv/config';
import { transcriptExport } from './transcriptExport';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { Engine, initialState, type Revision } from './engine';
import { defaultStore, reasoningOf, demoEnabled } from './generation';
import { id, Store } from './store';
import { Alternatives } from './alternatives';
import { Comparisons } from './comparisons';
import { Experiments } from './experiments';
import { saveAttachment, attachmentCapabilities, attachmentInfo, type Attachment } from './attachments';
import { stateChanges } from './changes';
import { Vault } from './vault';
import { People } from './people';
import { Runs, statusOf } from './runs';
import { assemblyOf, resolvedMap, resolveSpeaker, validRef, labelFor, validateLabel, generationProvenance, labelOf } from './identity';
import { EMPTY_FRAME, DEFAULT_FRAME } from '../speakerTurn';
import { visibility, scopeTag, stamp, knownPlace, placeName, whoLabel, HUMAN } from './locations';

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
  // Backup preflight asks the server to hold still; a read-only instance (restore verification) never mutates.
  app.locals.quiesced = false;
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    if (engine.store.readOnly) return res.status(403).json({ error: 'This instance is read-only.' });
    if (app.locals.quiesced && !req.path.startsWith('/admin/')) return res.status(503).json({ error: 'A backup is in progress; changes are paused.' });
    next();
  });
  app.use('/api/attachments', express.raw({type:'application/octet-stream',limit:'10mb'}));
  app.use(express.json({ limit: '8mb' }));
  const route = (fn: (req: any, res: any) => any) => (req: any, res: any, next: any) => Promise.resolve().then(() => fn(req,res)).catch(next);
  const store = engine.store;
  const comparisons = new Comparisons(engine);
  const alternatives = new Alternatives(engine);
  app.locals.alternatives=alternatives;
  const experiments = new Experiments(engine);
  const vault = new Vault(store), people = new People(engine, vault), runs = new Runs(engine);
  app.locals.vault = vault; app.locals.runs = runs; app.locals.people = people;
  app.post('/api/attachments',route(async(req,res)=>res.json(await saveAttachment(store,decodeURIComponent(String(req.headers['x-room-filename']||'')),req.body))));
  app.get('/api/attachments/:id',route((req,res)=>{const a=store.get<Attachment>('attachments',req.params.id);res.json({...attachmentInfo(a),text:a.text});}));
  app.get('/api/attachments/:id/file',route((req,res)=>{
    const a=store.get<Attachment>('attachments',req.params.id);
    res.attachment(a.name).type(a.mime);
    if(a.kind==='image'&&req.query.inline==='1')res.setHeader('Content-Disposition','inline');
    res.send(Buffer.from(a.data,'base64'));
  }));
  app.locals.experiments = experiments;
  const changes = (key: string) => { const b=engine.read(key); const fork=b.fork?store.get<Revision>('revisions',b.fork):null; return {fork:fork?{branch:fork.branch,revision:fork.id}:null,changes:fork?stateChanges(fork.state,b.revision.state):null}; };
  app.get('/api/attempts/:id/request',route((req,res)=>res.attachment('room-request.json').json(store.get('attempts',req.params.id))));
  const evidence = (branch: string, originalImages = false) => {
    const b = engine.read(branch);
    const revisions: Revision[] = []; let cursor: string | null = b.head;
    while (cursor) { const rev: Revision = store.get<Revision>('revisions', cursor); revisions.push(rev); cursor = rev.parent; }
    const ids = new Set(revisions.map(r => r.id));
    const relevant = (r: any) => r.branch === branch || ids.has(r.revision);
    const jevResults = new Map(store.list('jev-results').map(r => [r.id,r]));
    const attachmentIds=new Set(revisions.flatMap(r=>r.state.messages.flatMap(m=>m.attachments||[])));
    return { branch: b, revisions, alternatives:alternatives.evidence(branch), attachments:[...attachmentIds].map(key=>attachmentInfo(store.get<Attachment>('attachments',key))), changes: changes(branch), attempts: store.attempts().filter(relevant).map(a=>{
        const imageDataSummarized=!originalImages&&a.body.messages.some((m:any)=>Array.isArray(m.content)&&m.content.some((p:any)=>p.type==='image_url'));
        const body=imageDataSummarized?{...a.body,messages:a.body.messages.map((m:any)=>({...m,content:Array.isArray(m.content)?m.content.map((p:any)=>p.type==='image_url'?{...p,image_url:{...p.image_url,url:'[Image bytes retained in exact request download]'}}:p):m.content}))}:a.body;
        return {...a,body,imageDataSummarized,reasoning:reasoningOf(a.outcome)};
      }), selections: store.list('selections').filter(relevant),
      turns: store.list('turns').filter(r => r.branch === branch),
      reactions: (() => { const messages = new Set(revisions.flatMap(r => r.state.messages.map(m => m.id))); return store.list('reactions').filter(r => messages.has(r.message)).sort((a,b)=>a.message.localeCompare(b.message)||a.sequence-b.sequence); })(),
      imports: store.list('imports').filter(relevant),
      observations: store.list('observations').filter(r => r.branch === branch), edits: store.list('edits').filter(r => r.branch === branch),
      jev: store.list('jev-requests').filter(relevant).map(r => ({ ...r, outcome: jevResults.get(r.id) || null })) };
  };
  const activity = () => {
    const done = new Set(store.list('jev-results').map(r => r.id));
    const value = { turns: [...engine.active.keys()], runs: [...runs.pending.keys()], experiments: [...experiments.active.keys()], candidates: [...alternatives.active.keys()],
      shadow: store.list('jev-requests').filter(r => !done.has(r.id)).map(r => r.id), quiesced: !!app.locals.quiesced, readOnly: store.readOnly };
    return { ...value, busy: !!(value.turns.length || value.experiments.length || value.candidates.length || value.shadow.length) };
  };
  app.get('/api/admin/activity', route((_req,res) => res.json(activity())));
  app.post('/api/admin/quiesce', route((req,res) => { if (typeof req.body.on !== 'boolean') throw Error('Choose on or off'); app.locals.quiesced = req.body.on; res.json(activity()); }));
  app.get('/api/bootstrap', route((_req,res) => {
    const saved = comparisons.list(), library = engine.library();
    const trials = experiments.trialBranches();
    res.json({ ...library, attachments:attachmentCapabilities(), branches: library.branches.map(b => trials.has(b.id) ? { ...b, isTrial: true } : b), comparisons: saved, experiments: experiments.list(), reactions: reactions(),
      frame: EMPTY_FRAME, legacyFrame: DEFAULT_FRAME, readOnly: store.readOnly, keys: { opengateway: !!process.env.OPENGATEWAY_API_KEY, together: !!process.env.TOGETHER_API_KEY, jev: !!process.env.TYPESAFE_API_KEY, demo: demoEnabled() },
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
    const history = store.list('reactions'), branches = new Map(store.list('branches').map(b=>[b.id,b])), provenance = generationProvenance(store);
    return wanted.map(key => {
      const records = history.filter(r=>r.message===key).sort((a,b)=>a.sequence-b.sequence), last = records.at(-1), f = found.get(key);
      // The written label stays as evidence; identity is the resolved ref, which is only meaningful within its lineage (root conversation).
      const speakerRef = f ? resolveSpeaker(f.revision.state, f.message, provenance) : null;
      let root = f ? branches.get(f.revision.branch) : null; const seen = new Set<string>(); while (root?.parent && !seen.has(root.id) && branches.has(root.parent)) { seen.add(root.id); root = branches.get(root.parent); }
      return { message: key, value, at: last.at, branch: last.branch, branchName: branches.get(last.branch)?.name ?? null, speaker: f?.message.speaker ?? null, speakerRef,
        speakerLabelAtRevision: speakerRef?.kind === 'person' ? labelOf(f!.revision.state, speakerRef.id) : null,
        lineage: f ? { branch: f.revision.branch, revision: f.revision.id, root: root?.id ?? null, rootName: root?.name ?? null, comparison: root?.comparison ?? null } : null,
        text: f?.message.text ?? null, source: f?.message.source ?? null, turnId: f?.message.turnId ?? last.turnId, history: records };
    }).sort((a,b)=>b.at.localeCompare(a.at));
  }
  app.get('/api/reactions/:value', route((req,res) => { if (!['favorite','dislike'].includes(req.params.value)) throw Error('Invalid reaction'); res.json(marked(req.params.value)); }));
  app.get('/api/reactions/:value/export', route((req,res) => { if (!['favorite','dislike'].includes(req.params.value)) throw Error('Invalid reaction'); res.attachment(`room-${req.params.value}s.json`).json({ format: 'room-reactions-v1', value: req.params.value, exportedAt: new Date().toISOString(), items: marked(req.params.value).map(m => ({ ...m, attempts: store.attempts().filter(a => a.turnId && a.turnId === m.turnId).map(a=>({...a,reasoning:reasoningOf(a.outcome)}))})) }); }));
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
  app.post('/api/branches/:id/reviews',route((req,res)=>res.json(alternatives.open(req.params.id,req.body.message))));
  app.get('/api/reviews/:id',route((req,res)=>res.json(alternatives.get(req.params.id))));
  app.post('/api/reviews/:id/candidates',route(async(req,res)=>res.json(await alternatives.propose(req.params.id,req.body.feedback))));
  app.post('/api/candidates/:id/stop',route((req,res)=>res.json(alternatives.stop(req.params.id))));
  app.post('/api/candidates/:id/judge',route((req,res)=>res.json(alternatives.judge(req.params.id,req.body))));
  app.post('/api/candidates/:id/apply',route((req,res)=>res.json(alternatives.apply(req.params.id,req.body))));
  app.post('/api/reviews/:id/training',route((req,res)=>res.json(alternatives.curate(req.params.id,req.body))));
  app.get('/api/dataset',route((_req,res)=>res.json(alternatives.dataset())));
  app.get('/api/dataset/:kind',route((req,res)=>{
    const rows=alternatives.export(req.params.kind);res.attachment('room-'+req.params.kind+'.jsonl').type('application/x-ndjson').send(rows.map(row=>JSON.stringify(row)).join('\n')+(rows.length?'\n':''));
  }));
  app.post('/api/branches/:id/trash', route((req,res) => res.json(engine.trash(req.params.id,req.body.expected))));
  app.post('/api/trash/:id/restore', route((req,res) => res.json(engine.restore(req.params.id))));
  app.get('/api/comparisons/:id', route((req,res) => res.json(comparisons.get(req.params.id))));
  app.post('/api/comparisons/draft', route((req,res) => res.json(comparisons.save({name:'Unsaved comparison',left:req.body.left,right:req.body.right},null,true))));
  app.post('/api/comparisons', route((req,res) => res.json(comparisons.save(req.body))));
  app.post('/api/comparisons/:id/fork', route((req,res) => res.json(comparisons.fork(req.params.id,req.body.name,req.body.expected))));
  // Every new room is v2: empty, or snapshotted from a room template. Existing rooms keep their assembly.
  app.post('/api/branches', route((req,res) => res.json(people.createRoom(req.body))));
  app.get('/api/branches/:id', route((req,res) => { const e = evidence(req.params.id), s = e.branch.revision.state;
    res.json({ ...e, active: engine.active.has(req.params.id), identity: resolvedMap(s, generationProvenance(store)), people: people.status(s), template: people.templateStatus(s), assemblyVersion: assemblyOf(s), run: runs.active(req.params.id) }); }));
  // Conversation edits go through the explicit retcon operation; this is a field-level merge.
  app.post('/api/branches/:id/settings', route((req,res) => res.json(people.settings(req.params.id, req.body))));
  app.post('/api/branches/:id/people/preview', route((req,res) => res.json(people.previewAdd(req.params.id, req.body))));
  app.post('/api/branches/:id/people', route((req,res) => res.json(people.add(req.params.id, req.body))));
  app.get('/api/branches/:id/people/:person/assembled', route((req,res) => res.json(people.previewAssembled(req.params.id, req.params.person))));
  app.post('/api/branches/:id/people/:person/assembled', route((req,res) => res.json(people.previewAssembled(req.params.id, req.params.person, req.body))));
  app.post('/api/branches/:id/people/:person/rename', route((req,res) => res.json(people.rename(req.params.id, req.params.person, req.body))));
  app.post('/api/branches/:id/people/:person/participation', route((req,res) => res.json(people.participation(req.params.id, req.params.person, req.body))));
  app.post('/api/branches/:id/people/:person/adopt/preview', route((req,res) => res.json(people.previewPersona(req.params.id, req.params.person, req.body))));
  app.post('/api/branches/:id/people/:person/adopt', route((req,res) => res.json(people.adoptPersona(req.params.id, req.params.person, req.body))));
  app.post('/api/branches/:id/template/preview', route((req,res) => res.json(people.previewTemplate(req.params.id, req.body))));
  app.post('/api/branches/:id/template/adopt', route((req,res) => res.json(people.adoptTemplate(req.params.id, req.body))));
  // Runs: persisted before the first dispatch; the browser advances them one index at a time.
  app.get('/api/branches/:id/runs', route((req,res) => res.json(runs.list(req.params.id).map(r => ({ ...r, status: statusOf(r) })))));
  app.post('/api/branches/:id/runs', route((req,res) => { const r = runs.start(req.params.id, req.body); res.json({ ...r, status: statusOf(r) }); }));
  app.get('/api/runs/:id', route((req,res) => { const r = runs.get(req.params.id); res.json({ ...r, status: statusOf(r), pending: runs.pending.get(r.id)?.index ?? null }); }));
  app.post('/api/runs/:id/turns', route(async(req,res) => { const out = await runs.advance(req.params.id, req.body.index); res.json({ ...out, run: { ...out.run, status: statusOf(out.run) } }); }));
  app.post('/api/runs/:id/stop', route((req,res) => { const r = runs.stop(req.params.id); res.json({ ...r, status: statusOf(r) }); }));
  // Vault: no route here makes a provider call.
  app.get('/api/vault', route((_req,res) => res.json({ items: vault.list(), kinds: vault.kinds() })));
  app.post('/api/vault', route((req,res) => res.json(vault.create(req.body))));
  app.post('/api/vault/compile', route((req,res) => res.json(vault.compile(req.body))));
  app.get('/api/vault/revisions/:rev', route((req,res) => res.json(vault.revision(req.params.rev))));
  app.get('/api/vault/:id', route((req,res) => res.json(vault.detail(req.params.id))));
  app.get('/api/vault/:id/diff', route((req,res) => res.json(vault.diff(req.params.id, String(req.query.from), String(req.query.to)))));
  app.post('/api/vault/:id/revise', route((req,res) => res.json(vault.revise(req.params.id, req.body))));
  app.post('/api/vault/:id/archive', route((req,res) => res.json(vault.archive(req.params.id, req.body))));
  app.get('/api/vault-kinds', route((_req,res) => res.json(vault.kinds())));
  app.post('/api/vault-kinds', route((req,res) => res.json(vault.createKind(req.body))));
  app.post('/api/vault-kinds/:id/revise', route((req,res) => res.json(vault.reviseKind(req.params.id, req.body))));
  app.post('/api/vault-kinds/:id/archive', route((req,res) => res.json(vault.archiveKind(req.params.id, req.body))));
  app.post('/api/branches/:id/messages', route((req,res) => { const before = engine.read(req.params.id).head, b = engine.message(req.params.id, req.body.expected, req.body.text || '',req.body.attachments); runs.humanMessage(b.id, before, b.head); res.json(b); }));
  app.post('/api/branches/:id/messages/:message/delete', route((req,res) => res.json(engine.deleteMessage(req.params.id,req.body.expected,req.params.message))));
  app.post('/api/branches/:id/messages/restore', route((req,res) => res.json(engine.restoreMessage(req.params.id,req.body.expected,req.body.deletion))));
  // A direct turn in a room with locations names a concrete place; rotation exists only inside a persisted run.
  app.post('/api/branches/:id/turn', route(async(req,res) => { if (req.body.place === 'rotate') throw Error('Rotation is only available in a run'); res.json(await engine.turn(req.params.id, req.body.expected, req.body.speaker || undefined, runInfo(req.body.run), undefined, undefined, req.body.place !== undefined ? { place: req.body.place } : undefined)); }));
  // Locations. None of these routes makes a provider call.
  app.post('/api/branches/:id/locations/preview', route((req,res) => res.json(people.previewLocations(req.params.id, req.body))));
  app.post('/api/branches/:id/locations', route((req,res) => res.json(people.enableLocations(req.params.id, req.body))));
  app.post('/api/branches/:id/locations/places/:place/rename', route((req,res) => res.json(people.renamePlace(req.params.id, req.params.place, req.body))));
  app.post('/api/branches/:id/move/preview', route((req,res) => { const s = engine.read(req.params.id).revision.state, { message } = engine.planMove(s, req.body); res.json({ text: message.text, movement: message.movement, audience: message.audience, tag: scopeTag(message) }); }));
  app.post('/api/branches/:id/move', route((req,res) => { const b = engine.move(req.params.id, req.body.expected, req.body); runs.interrupt(b.id, 'People moved; placement changed'); res.json(b); }));
  app.post('/api/branches/:id/narration', route((req,res) => { const b = engine.narrate(req.params.id, req.body.expected, req.body.text, req.body.place); runs.interrupt(b.id, 'Narration interrupts a run'); res.json(b); }));
  app.post('/api/branches/:id/messages/:message/audience/preview', route((req,res) => res.json(engine.planAudience(engine.read(req.params.id).revision.state, req.params.message, req.body.audience).change)));
  app.post('/api/branches/:id/messages/:message/audience', route((req,res) => res.json(engine.setAudience(req.params.id, req.body.expected, req.params.message, req.body.audience))));
  // "As seen by X at revision R": X's next-request history projection, from the same function dispatch uses.
  app.get('/api/branches/:id/seen/:person', route((req,res) => {
    const b = engine.read(req.params.id), at = typeof req.query.revision === 'string' ? req.query.revision : b.head;
    let cursor: string | null = b.head; while (cursor && cursor !== at) cursor = store.get<Revision>('revisions', cursor).parent;
    if (!cursor) throw Error('That revision is not part of this conversation');
    const s = store.get<Revision>('revisions', at).state, person = req.params.person;
    if (!s.locations) throw Error('This revision has no locations');
    if (person !== HUMAN && !s.characters[person]) throw Error('Unknown person');
    res.json({ revision: at, label: whoLabel(s, person), placeName: placeName(s, s.locations.at[person]), ...visibility(s, person) });
  }));
  app.post('/api/branches/:id/stop', route((req,res) => { engine.cancel(req.params.id); res.json({ ok: true }); }));
  app.post('/api/branches/:id/fork', route((req,res) => res.json(engine.fork(req.params.id, req.body.revision, String(req.body.name || 'Alternate continuation'), req.body.messageId))));
  app.post('/api/branches/:id/retcon', route((req,res) => res.json(engine.retcon(req.params.id, req.body.expected, req.body.messageId, String(req.body.text ?? ''), req.body.mode, req.body.memory))));
  app.post('/api/branches/:id/history', route((req,res) => {
    const b = engine.read(req.params.id);
    if (b.head !== req.body.expected) throw Error('Branch changed; reload before retconning');
    if (!Array.isArray(req.body.messages) || !['keep','clear'].includes(req.body.memory)) throw Error('Invalid history retcon');
    const previous = b.revision.state, state = structuredClone(previous), v2 = assemblyOf(state) === 'v2', provenance = generationProvenance(store);
    const originals = new Map(state.messages.map(m => [m.id,m]));
    // Audience is never edited here: existing lines keep theirs, and each new line in a room with locations needs a place or public.
    const scoped = (m: any, old: any, ref: any) => {
      if (old) { if (m.audience !== undefined && JSON.stringify(m.audience) !== JSON.stringify(old.audience ?? null)) throw Error('Change who heard a line with its audience edit, not in the history editor'); return { ...(old.audience ? { audience: old.audience } : {}), ...(old.movement ? { movement: old.movement } : {}) }; }
      if (!state.locations) { if (m.audience != null) throw Error('This room has no locations'); return {}; }
      if (m.audience === undefined) throw Error('Choose a place or public for each new line');
      if (m.audience === null) return {};
      if (!m.audience || Object.keys(m.audience).join() !== 'place' || !knownPlace(state, m.audience.place)) throw Error('Choose a known place or public for each new line');
      const audience = stamp(state, m.audience.place), who = ref?.kind === 'person' ? ref.id : ref?.kind === 'human' ? HUMAN : null;
      if (who && !audience.present.includes(who)) throw Error(`${whoLabel(state, who)} is not in ${placeName(state, m.audience.place)}. Insert the line as public or elsewhere, then use an audience edit.`);
      return { audience };
    };
    // Text-only edits keep attribution. Changing it takes an explicit choice; a retyped label never silently reassigns identity.
    state.messages = req.body.messages.map((m: any) => {
      const old = originals.get(m.id), typed = typeof m.speaker === 'string' ? m.speaker.trim() : '';
      if (m.speakerRef !== undefined && !validRef(m.speakerRef)) throw Error('Choose a person, you, the narrator or unbound for each message');
      const refChanged = m.speakerRef !== undefined && (!old || JSON.stringify(m.speakerRef) !== JSON.stringify(resolveSpeaker(previous, old, provenance)));
      const speakerChanged = !!old && !refChanged && typed !== old.speaker;
      if (old && old.text === m.text && !refChanged && !speakerChanged) { scoped(m, old, null); return old; }
      // Every newly edited line records its resolved attribution; historical records are never touched.
      const ref = refChanged ? m.speakerRef : speakerChanged ? { kind: 'unbound' } : old ? resolveSpeaker(previous, old, provenance) : v2 ? { kind: 'unbound' } : undefined;
      const speaker = refChanged || (!old && ref) ? labelFor(state, ref, typed) : speakerChanged || !old ? typed : old.speaker;
      if (v2 && ref?.kind === 'unbound' && (speakerChanged || !old || refChanged)) validateLabel(speaker);
      return { id: id(), speaker, ...(ref ? { speakerRef: ref } : {}), text: m.text, source: 'edited', ...(old ? {editedFrom:[old.id,...(old.editedFrom||[])],turnId:old.turnId, ...(old.attachments?{attachments:old.attachments}:{})} : {}), ...scoped(m, old, ref) };
    });
    if (req.body.memory === 'clear') for (const c of Object.values(state.characters)) c.memory = '';
    if (engine.active.has(b.id)) throw Error('Stop generation before editing history');
    const result = engine.commit(b.id, req.body.expected, state, 'History retconned');
    store.add('edits', { branch:result.id, sourceRevision:b.head, kind:'history', memory:req.body.memory, at:new Date().toISOString() });
    res.json(result);
  }));
  app.post('/api/branches/:id/observations', route((req,res) => {
    const b = engine.read(req.params.id);
    if (typeof req.body.text !== 'string' || !req.body.text.trim()) throw Error('Write an observation first');
    const observation = { id: id(), branch: b.id, revision: b.head, at: new Date().toISOString(), text: req.body.text.slice(0,20000), messageId: req.body.messageId || null };
    store.add('observations',observation); res.json(observation);
  }));
  app.get('/api/branches/:id/transcript', route((req,res) => {const b=engine.read(req.params.id);res.type('html').send(transcriptExport(b.name,b.revision.state));}));
  // Markdown transcript: written labels, with location tags from the stamped snapshots. No prompts or research records.
  app.get('/api/branches/:id/transcript.md', route((req,res) => {const b=engine.read(req.params.id),s=b.revision.state;res.type('text/markdown').attachment('room-transcript.md').send(`# ${b.name}\n\n`+(s.messages.map(m=>`**${m.speaker}**${scopeTag(m)?' '+scopeTag(m):''}\n\n${m.text}`).join('\n\n')||'_No messages yet._')+'\n');}));
  app.get('/api/branches/:id/export', route((req,res) => res.attachment('room-research.json').json((()=>{const record=evidence(req.params.id,true),s=record.branch.revision.state;return {format:'room-workbench-v1',...record,...(s.locations?{locationTags:Object.fromEntries(s.messages.filter(m=>scopeTag(m)).map(m=>[m.id,scopeTag(m)]))}:{}),attachments:record.attachments.map(a=>store.get<Attachment>('attachments',a.id))};})())));
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
// Marks interrupted work after a restart. Skipped on read-only instances, which must not write.
export function recoverOnStartup(app: express.Express, store: Store) {
  if (store.readOnly) return;
  // Discord uses the same attempt store but owns its own in-flight requests.
  for (const attempt of store.attempts()) if (attempt.branch && !attempt.outcome) store.put('outcomes', attempt.id, { id: attempt.id, status: 'interrupted', error: 'Process ended before an outcome was recorded' });
  const done = new Set(store.list('jev-results').map(r => r.id));
  for (const r of store.list('jev-requests')) if (!done.has(r.id)) store.put('jev-results',r.id,{ id:r.id,status:'interrupted',error:'Process ended before a result was recorded' });
  app.locals.experiments.recover();
  app.locals.alternatives.recover();
  app.locals.runs.recover();
  app.locals.vault.seedKinds();
}
if (require.main === module) {
  const store = defaultStore();
  const port = Number(process.env.ROOM_PORT || 4317);
  const app = createApp(new Engine(store));
  const server = app.listen(port, '127.0.0.1', () => {
    // Only recover browser requests after successfully acquiring the listening port.
    recoverOnStartup(app, store);
    console.log(`Room workbench: http://127.0.0.1:${port}${store.readOnly ? ' (read-only)' : ''}`);
  });
  server.on('error', err => { console.error(err.message); process.exitCode = 1; });
}
