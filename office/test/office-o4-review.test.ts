import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { collect } from '../collect/index';
import { Allowlist, type Config } from '../collect/privacy';
import { fans, maskerFor } from '../collect/rooms';
import { createOffice } from '../server';

// Review fixes on d3663e1 (Claude reviewer + Codex privacy NO-GO): blinding of room records, nested manifests, seeded order,
// opaque unknown actors, allowsDir exclusions under work/ and research/.
const roots: string[] = []; test.after(() => roots.forEach(r => fs.rmSync(r, { recursive: true, force: true })));
const sha = (b: string | Buffer) => crypto.createHash('sha256').update(b).digest('hex');
let k = 0; const id = () => { const h = sha('id' + ++k); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };
const W = (p: string, v: unknown) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v)); };
const MARK = { turn: 'TURN-TEXT-MARKER', sys0: 'ARM-TEMPLATE-V0-MARKER', sys1: 'ARM-TEMPLATE-V1-MARKER' };

// A masked compare run whose rooms live in .room-data: room branch → parent checkpoint branch ("date·v1·checkpoint") →
// its parent template branch (named nowhere in coordination/: reached only through the records); revisions whose
// state.system is the arm template; turns, attempts and outcomes. `sub` nests the run folder (review P1-b).
function blindFixture(sub = '') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'office-review-'))); roots.push(root);
  const coord = path.join(root, 'coordination'), op = path.join(coord, '2026-10-17/date'), dir = path.join(op, sub), rd = path.join(root, 'rd');
  const cfg: Config = { home: path.join(root, 'home'), room: root, coordination: coord, promptKnowledge: path.join(root, 'pk'), roomData: rd, claudeProject: path.join(root, 'proj'), spool: path.join(root, 'spool'),
    repos: [], work: path.join(root, 'work'), research: path.join(root, 'research'), extra: [] };
  fs.mkdirSync(cfg.claudeProject, { recursive: true });
  const rooms: any[] = [];
  for (const arm of ['v0', 'v1']) {
    const tplB = id(), ckB = id(), ckR = id(), room = id(), rev = id(), turn = id(), att = id(), msg = id(), sys = arm === 'v0' ? MARK.sys0 : MARK.sys1;
    W(path.join(rd, 'branches', tplB + '.json'), { id: tplB, name: `date·${arm}·template` });
    W(path.join(rd, 'branches', ckB + '.json'), { id: ckB, name: `date·${arm}·checkpoint`, parent: tplB, head: ckR });
    W(path.join(rd, 'revisions', ckR + '.json'), { id: ckR, state: { system: sys, messages: [] } });
    W(path.join(rd, 'branches', room + '.json'), { id: room, name: `date·compare·${arm}·r01`, parent: ckB, fork: ckR, head: rev });
    W(path.join(rd, 'revisions', rev + '.json'), { id: rev, parent: ckR, state: { system: sys, messages: [{ id: msg, speaker: 'Jake', text: MARK.turn + ' ' + arm }] } });
    W(path.join(rd, 'turns', turn + '.json'), { id: turn, branch: room, revision: rev, attempts: [att] });
    W(path.join(rd, 'attempts', att + '.json'), { id: att, turnId: turn, body: { system: sys } });
    W(path.join(rd, 'outcomes', att + '.json'), { id: att, text: MARK.turn + ' raw ' + arm });
    rooms.push({ arm, tplB, ckB, ckR, room, rev, turn, att, msg, traj: `compare·${arm}·r01` });
  }
  const man = rooms.flatMap((r, i) => [{ at: `2026-10-17T20:02:58.0${i}0Z`, kind: 'branch', traj: r.traj, branch: r.room, from: { branch: r.ckB, revision: r.ckR } },
    { at: `2026-10-17T20:03:0${i}.000Z`, kind: 'done', traj: r.traj, turn: 1, turnId: r.turn, outputRevision: r.rev, messageId: r.msg }]).sort((a, b) => a.at.localeCompare(b.at));
  W(path.join(dir, 'manifest-compare.jsonl'), man.map(x => JSON.stringify(x)).join('\n') + '\n');
  W(path.join(op, 'checkpoints.json'), { v1: { branch: rooms[1].ckB, revision: rooms[1].ckR } });
  W(path.join(op, 'template-v1.md'), '# Template v1\n' + MARK.sys1 + '\n');
  W(path.join(op, 'restricted/key.json'), { 'T-11111111': { traj: rooms[0].traj, branch: rooms[0].room }, 'T-22222222': { traj: rooms[1].traj, branch: rooms[1].room } });
  W(path.join(op, '71-date-v1-proposal.md'), '# Date v1\nThe v1 checkpoint is date·v1·checkpoint; arms date·v0 and date·v1.\n');
  return { root, cfg, op, dir, rd, rooms };
}
const serve = async (cfg: Config) => { const o = createOffice(cfg), srv = o.app.listen(0, '127.0.0.1'); await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`; return { o, text: async (u: string) => (await fetch(base + u)).text(), json: async (u: string) => (await fetch(base + u)).json(), close: () => new Promise(r => srv.close(r)) }; };
const file = (p: string) => '/api/expand/file?path=' + encodeURIComponent(p);

async function crawl(cfg: Config, extra: string[] = []) {
  const s = await serve(cfg);
  try {
    let all = await s.text('/api/summary') + await s.text('/api/events?op=*') + await s.text('/api/rooms?op=2026-10-17/date') + await s.text('/api/archive?op=*');
    for (const e of (await s.json('/api/events?op=*')).events) all += await s.text('/api/expand/event/' + e.id) + await s.text('/api/expand/event/' + e.id + '/prose');
    const files: { p: string; r: any }[] = [];
    for (const p of extra) { const r = await s.json(file(p)); files.push({ p, r }); all += JSON.stringify(r); }
    return { all, files };
  } finally { await s.close(); }
}

test('blinding 1+2: a masked operation\'s room records (turns, attempts, outcomes, revisions, branches) and the branch → parent → checkpoint chain are path-only; arm tokens are masked by pattern', async () => {
  const { cfg, op, rd, rooms } = blindFixture(), recs = rooms.flatMap(r => [['branches', r.room], ['branches', r.ckB], ['branches', r.tplB], ['revisions', r.rev], ['revisions', r.ckR], ['turns', r.turn], ['attempts', r.att], ['outcomes', r.att]].map(([k, x]) => path.join(rd, k, x + '.json')));
  const drivers = [path.join(op, 'checkpoints.json'), path.join(op, 'template-v1.md'), path.join(op, 'manifest-compare.jsonl')];
  const { all, files } = await crawl(cfg, [...recs, ...drivers, path.join(op, '71-date-v1-proposal.md')]);
  for (const { p, r } of files.filter(f => !f.p.endsWith('proposal.md'))) assert.equal(r.allowed, false, 'path-only while masked: ' + path.relative(path.dirname(rd), p));
  for (const m of [MARK.turn, MARK.sys0, MARK.sys1]) assert.ok(!all.includes(m), 'no room text or arm template: ' + m);
  assert.ok(!/·v[01]·/.test(all), 'no ·vN· token anywhere'); assert.ok(!/date·v[01]\b/.test(all), 'arm tokens from key.json masked by pattern');
  assert.ok(all.includes('date·arm-masked·checkpoint'), 'the packet\'s checkpoint name is masked, not dropped');
  // the turn's Expand: shape only, the room message path-only
  const c = collect(cfg), turnEv = c.events.find(e => e.detailRef.kind === 'manifest-turn-masked')!, s = await serve(cfg);
  try { const x = await s.json('/api/expand/event/' + turnEv.id); assert.ok(x.sections.some((y: any) => y.title === 'driver record' && y.allowed === false)); assert.ok(!JSON.stringify(x).includes('TURN-TEXT')); } finally { await s.close(); }
  // a record created later that names a masked room is masked by content
  const late = id(); W(path.join(rd, 'attempts', late + '.json'), { id: late, branch: rooms[0].room, body: MARK.sys0 }); assert.equal(c.allow.read(path.join(rd, 'attempts', late + '.json')).allowed, false);
  // unmasked: the records become readable
  const lock = JSON.stringify({ at: '2026-10-18T19:00:00Z' }); W(path.join(op, 'labels-lock.json'), lock);
  W(path.join(op, 'restricted/unmask.json'), { operation: '2026-10-17/date', at: '2026-10-18T20:00:00Z', by: 'deniz', labelsLock: { file: 'labels-lock.json', sha256: sha(lock) }, keySha256: sha(fs.readFileSync(path.join(op, 'restricted/key.json'))) });
  await new Promise(r => setTimeout(r, 2100)); // the blind index and folder list are rechecked at most every 1-2 s
  const after = await crawl(cfg, recs.slice(0, 4)); assert.ok(after.files.every(f => f.r.allowed), 'after a valid unmask the room records are readable'); assert.ok(after.all.includes(MARK.turn));
});

test('blinding 3: the masker sees exactly the manifests the collector parses, at any depth, and fails closed on a trajectory it never learned', async () => {
  for (const sub of ['x/run', '']) {
    const { cfg, op } = blindFixture(sub);
    if (!sub) { // work/thing/a/b/c/d/manifest-*.jsonl, deeper than the old three levels
      const w = path.join(cfg.work!, 'thing'); W(path.join(w, 'restricted/key.json'), { 'T-1': { traj: 'deep·v1·r09' } });
      W(path.join(w, 'a/b/c/d/manifest-deep.jsonl'), ['deep·v0·r09', 'deep·v1·r09'].map((t, i) => JSON.stringify({ at: `2026-10-19T09:0${i}:00Z`, kind: 'done', traj: t, turn: 1, turnId: id() })).join('\n') + '\n');
      assert.equal(maskerFor(new Allowlist(cfg), w, 'work/thing').trajs.length, 2);
    } else assert.deepEqual(maskerFor(new Allowlist(cfg), op, '2026-10-17/date').trajs.sort(), ['compare·v0·r01', 'compare·v1·r01'], 'coordination/<day>/x/run/manifest-*.jsonl');
    // a trajectory no manifest names, in a folder with restricted/: masked by the fallback
    assert.equal(maskerFor(new Allowlist(cfg), op, '2026-10-17/date').name('other·v1·r77'), 'other·r77·room ?');
    W(path.join(op, '72-notes.md'), '# notes\nunlearned: other·v1·r77 and rogue·v3·r01\n');
    const { all } = await crawl(cfg, [path.join(op, '72-notes.md')]);
    assert.ok(!/·v\d+·/.test(all), 'nested and unlearned trajectories masked (' + (sub || 'work/thing/a/b/c/d') + ')');
  }
});

test('blinding 4: while masked, rooms come in a seeded order and their creation times are coarsened, on the floor and in the fans', () => {
  const { cfg, op } = blindFixture(), c = collect(cfg);
  const br = c.events.filter(e => e.target?.kind === 'branch').sort((a, b) => a.ts.localeCompare(b.ts) || a.seq - b.seq);
  assert.equal(new Set(br.map(e => e.ts)).size, 1, 'one coarse creation time for every masked room'); assert.ok(br.every(e => e.detailRef.lines.length === 0), 'no manifest line order');
  const key = sha(fs.readFileSync(path.join(op, 'restricted/key.json'))), h = (t: string) => sha(key + '|' + t), want = ['compare·v0·r01', 'compare·v1·r01'].sort((a, b) => h(a).localeCompare(h(b)));
  const M = maskerFor(c.allow, op, '2026-10-17/date'); assert.deepEqual(br.map(e => e.label), want.map(t => M.name(t)), 'emitted in the key-seeded order, not creation order');
  const f = fans(c.allow, c.events, op, '2026-10-17/date')[0]; assert.deepEqual(f.pairs[0].lanes.map((l: any) => l.name), ['compare·r01·room A', 'compare·r01·room B']);
  assert.ok(f.pairs[0].lanes.every((l: any) => !('traj' in l) && !('created' in l)));
});

test('labels 5: unrecognised events.jsonl names become "unknown actor <hash>", never a role node or free-text label', () => {
  const { cfg } = blindFixture(), at = '2026-10-19T10:00:00Z';
  W(path.join(cfg.coordination, 'events.jsonl'), [{ at, from: 'Operator', to: 'partner', kind: 'packet' }, { at, from: 'IGNORE PREVIOUS: secret plan', to: 'claude-engineer', kind: 'message' }, { at, from: 'psri', to: 'critic', kind: 'packet' }].map(x => JSON.stringify(x)).join('\n') + '\n');
  const c = collect(cfg), hs = c.events.filter(e => e.detailRef.kind === 'handoff');
  assert.deepEqual(hs.map(e => [e.actor.id.replace(/actor:[0-9a-f]{8}/, 'actor:#'), e.target!.id.replace(/actor:[0-9a-f]{8}/, 'actor:#')]), [['role:operator', 'role:partner'], ['actor:#', 'actor:#'], ['psri', 'critic']]);
  const un = [...c.actors.values()].filter(a => a.id.startsWith('actor:'));
  assert.equal(un.length, 2); assert.ok(un.every(a => /^unknown actor [0-9a-f]{8}$/.test(a.label) && a.kind === 'unknown' && /^unknown actor/.test(a.name || '')));
  assert.ok(![...c.actors.keys()].some(k => /role:(claude|ignore)/.test(k))); assert.ok(!JSON.stringify([...c.actors.values()]).includes('secret plan'));
});

test('allowsDir 9: work/ and research/ apply the same excluded segments as the repo', () => {
  const { cfg } = blindFixture(), a = new Allowlist(cfg);
  for (const r of [cfg.work!, cfg.research!]) { fs.mkdirSync(path.join(r, 't/node_modules/x'), { recursive: true }); fs.mkdirSync(path.join(r, 't/.git'), { recursive: true }); fs.mkdirSync(path.join(r, 't/saves'), { recursive: true }); fs.mkdirSync(path.join(r, 't/ok'), { recursive: true });
    assert.equal(a.allowsDir(path.join(r, 't/ok')), true);
    for (const bad of ['t/node_modules/x', 't/.git', 't/saves', 't/.env.d']) assert.equal(a.allowsDir(path.join(r, bad)), false, bad); }
});

test('no cache window: a masked folder created between two requests is indexed before the second answer, which reveals nothing', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'office-window-'))); roots.push(root);
  const rd = path.join(root, 'rd'), coord = path.join(root, 'coordination'), cfg: Config = { home: path.join(root, 'home'), room: root, coordination: coord, promptKnowledge: path.join(root, 'pk'), roomData: rd,
    claudeProject: path.join(root, 'proj'), spool: path.join(root, 'spool'), repos: [], work: path.join(root, 'work'), research: path.join(root, 'research'), extra: [] };
  fs.mkdirSync(path.join(coord, '2026-10-19'), { recursive: true }); fs.mkdirSync(cfg.claudeProject, { recursive: true });
  const room = id(), rec = path.join(rd, 'branches', room + '.json'); W(rec, { id: room, name: 'late·v1·r01', state: { system: MARK.sys1 } });
  const s = await serve(cfg);
  try {
    assert.equal((await s.json(file(rec))).allowed, true, 'no masked operation yet: readable');
    // within any cache window: a new operation folder with restricted/ and a manifest naming that room
    const dir = path.join(coord, '2026-10-19/late'); W(path.join(dir, 'restricted/key.json'), { 'T-9': { traj: 'late·v1·r01', branch: room } });
    W(path.join(dir, 'manifest-late.jsonl'), JSON.stringify({ at: '2026-10-19T12:00:00Z', kind: 'branch', traj: 'late·v1·r01', branch: room }) + '\n');
    W(path.join(dir, '01-late-notes.md'), '# notes\nroom late·v1·r01\n');
    const r2 = await s.json(file(rec)), notes = await s.text(file(path.join(dir, '01-late-notes.md'))), man = await s.json(file(path.join(dir, 'manifest-late.jsonl')));
    assert.equal(r2.allowed, false, 'the room record is path-only on the very next request'); assert.ok(!JSON.stringify(r2).includes(MARK.sys1));
    assert.equal(man.allowed, false); assert.ok(!/·v1·/.test(notes), 'arm masked in text on the next request');
    // a room record written after the index was built is masked until the index has classified it
    const fresh = id(); W(path.join(rd, 'turns', fresh + '.json'), { id: fresh, text: MARK.turn }); assert.equal((await s.json(file(path.join(rd, 'turns', fresh + '.json')))).allowed, false);
  } finally { await s.close(); }
});

test('blinding recheck: masked per-turn driver events (requests and completions) never order a pair by arm', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'office-order-'))); roots.push(root);
  const coord = path.join(root, 'coordination'), dir = path.join(coord, '2026-10-17/date'), cfg: Config = { home: path.join(root, 'home'), room: root, coordination: coord, promptKnowledge: path.join(root, 'pk'),
    roomData: path.join(root, 'rd'), claudeProject: path.join(root, 'proj'), spool: path.join(root, 'spool'), repos: [], work: path.join(root, 'work'), research: path.join(root, 'research'), extra: [] };
  fs.mkdirSync(cfg.claudeProject, { recursive: true }); W(path.join(dir, 'restricted/key.json'), { 'T-1': { traj: 'compare·v0·r01' } });
  // the real driver's order: within every pair and turn, v0's request goes out first (2 ms earlier, lower line); completions vary
  const lines: any[] = [], pairs = ['r01', 'r02', 'r03', 'r04', 'r05', 'r06'];
  for (const p of pairs) for (const arm of ['v0', 'v1']) lines.push({ at: '2026-10-17T20:02:58.000Z', kind: 'branch', traj: `compare·${arm}·${p}`, branch: id() });
  pairs.forEach((p, i) => [1, 2].forEach(t => { const base = Date.parse('2026-10-17T20:03:00Z') + i * 10e3 + t * 60e3;
    for (const [k, arm] of ['v0', 'v1'].entries()) lines.push({ at: new Date(base + k * 2).toISOString(), kind: 'intent', traj: `compare·${arm}·${p}`, turn: t, pick: { label: 'Jake' } });
    for (const [k, arm] of ['v1', 'v0'].entries()) lines.push({ at: new Date(base + 3000 + k * 500 + (i % 2) * 2000 * (k ? -1 : 1)).toISOString(), kind: 'done', traj: `compare·${arm}·${p}`, turn: t, turnId: id() }); }));
  W(path.join(dir, 'manifest-compare.jsonl'), lines.map(x => JSON.stringify(x)).join('\n') + '\n');
  const s = await serve(cfg);
  try {
    const evs = (await s.json('/api/events?op=*')).events.filter((e: any) => e.source.endsWith('manifest-compare.jsonl'));
    const driven = evs.filter((e: any) => ['dispatch', 'write', 'turn'].includes(e.verb) && e.target?.id !== 'coordinator');
    assert.ok(driven.length === 12 + 24 + 24 && driven.every((e: any) => e.detailRef.lines.length === 0), 'no manifest line numbers on masked per-room events');
    // requests: one time per pair and turn, so the response order is the only order left; it must not follow the arm
    const key = sha(fs.readFileSync(path.join(dir, 'restricted/key.json'))), h = (t: string) => sha(key + '|' + t);
    const M = maskerFor(new Allowlist(cfg), dir, '2026-10-17/date'), armOf = new Map(['v0', 'v1'].flatMap(a => pairs.map(p => [M.name(`compare·${a}·${p}`), a] as const)));
    let v0First = 0, groups = 0;
    for (const p of pairs) for (const t of [1, 2]) {
      const g = driven.filter((e: any) => e.verb === 'dispatch' && e.label.startsWith(`compare·${p}·`) && e.label.includes(` t${t} `));
      assert.equal(g.length, 2); assert.equal(g[0].ts, g[1].ts, 'one coarse time per pair and turn'); groups++;
      const room = (e: any) => e.label.split(' ')[0] + ' ' + e.label.split(' ')[1];
      if (armOf.get(room(g[0])) === 'v0') v0First++;
      assert.deepEqual(g.map(room), ['v0', 'v1'].map(a => `compare·${a}·${p}`).sort((x, y) => h(x).localeCompare(h(y))).map(t => M.name(t)), 'seeded order');
    }
    assert.ok(v0First > 0 && v0First < groups, `pair order does not follow the arm (v0 first in ${v0First}/${groups})`);
    const all = JSON.stringify(evs) + await s.text('/api/rooms?op=2026-10-17/date'); assert.ok(!/·v[01]·/.test(all));
  } finally { await s.close(); }
});

test('live: a masked pair-turn never streams a lone member across a poll tick; held events come out together in seeded order (or coarsened once stopped)', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'office-live-pair-'))); roots.push(root);
  const coord = path.join(root, 'coordination'), dir = path.join(coord, '2026-10-17/date'), man = path.join(dir, 'manifest-compare.jsonl'), cfg: Config = { home: path.join(root, 'home'), room: root, coordination: coord,
    promptKnowledge: path.join(root, 'pk'), roomData: path.join(root, 'rd'), claudeProject: path.join(root, 'proj'), spool: path.join(root, 'spool'), repos: [], work: path.join(root, 'work'), research: path.join(root, 'research'), extra: [] };
  fs.mkdirSync(cfg.claudeProject, { recursive: true }); W(path.join(dir, 'restricted/key.json'), { 'T-1': { traj: 'compare·v0·r01' } });
  const rec = (o: any) => fs.appendFileSync(man, JSON.stringify(o) + '\n');
  rec({ at: '2026-10-17T20:02:00.000Z', kind: 'phase-start', phase: 'compare', trajectories: ['compare·v0·r01', 'compare·v1·r01', 'compare·v0·r02', 'compare·v1·r02'] });
  const pairs = ['r01', 'r02'], now = Date.now(), at = (ms: number) => new Date(now - 60e3 + ms).toISOString();
  for (const p of pairs) for (const a of ['v0', 'v1']) rec({ at: at(0), kind: 'branch', traj: `compare·${a}·${p}`, branch: id() });
  const o = createOffice(cfg, {}), srv = o.app.listen(0, '127.0.0.1'); await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, ctl = new AbortController(), res = await fetch(base + '/api/live', { signal: ctl.signal }), rd = res.body!.getReader(), dec = new TextDecoder(); let raw = '';
  const pump = (async () => { try { for (;;) { const { done, value } = await rd.read(); if (done) break; raw += dec.decode(value); } } catch {} })();
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
  try {
    await wait(50);
    // tick 1: only v0's request of r01 t1 (the driver's real order); tick 2: v1's; then r02's v0 only, until the pair is stopped
    rec({ at: at(1000), kind: 'intent', traj: 'compare·v0·r01', turn: 1, pick: { label: 'Jake' } }); o.live.tick(); await wait(50);
    rec({ at: at(1002), kind: 'intent', traj: 'compare·v1·r01', turn: 1, pick: { label: 'Megan' } }); o.live.tick(); await wait(50);
    rec({ at: at(2000), kind: 'intent', traj: 'compare·v0·r02', turn: 1, pick: { label: 'Jake' } }); o.live.tick(); await wait(50);
    rec({ at: at(3000), kind: 'phase-end', phase: 'compare', stoppedPairs: { 'compare·r02': 'quota' } }); o.live.tick(); await wait(80);
  } finally { ctl.abort(); await pump; await new Promise(r => srv.close(r)); o.live.stop(); }
  const msgs = raw.split('\n\n').filter(b => b.startsWith('event: events')).map(b => JSON.parse(b.split('\ndata: ')[1]));
  const disp = msgs.map(m => m.upserts.filter((e: any) => e.verb === 'dispatch' && e.source === man));
  assert.ok(!/·v[01]·/.test(raw), 'masked on the stream');
  const r01 = disp.map(d => d.filter((e: any) => e.label.startsWith('compare·r01·'))).filter(d => d.length);
  assert.equal(r01.length, 1, 'r01 t1 streamed in exactly one message'); assert.equal(r01[0].length, 2, 'never a lone member');
  assert.equal(r01[0][0].ts, r01[0][1].ts); assert.ok(r01[0].every((e: any) => !e.detailRef.lines.length));
  const key = sha(fs.readFileSync(path.join(dir, 'restricted/key.json'))), h = (t: string) => sha(key + '|' + t), M = maskerFor(new Allowlist(cfg), dir, '2026-10-17/date');
  assert.deepEqual(r01[0].map((e: any) => e.label.split(' ').slice(0, 2).join(' ')), ['compare·v0·r01', 'compare·v1·r01'].sort((a, b) => h(a).localeCompare(h(b))).map(t => M.name(t)), 'seeded order');
  const r02 = disp.findIndex(d => d.some((e: any) => e.label.startsWith('compare·r02·'))), stopAt = msgs.findIndex(m => m.upserts.some((e: any) => e.verb === 'block'));
  assert.ok(r02 >= 0 && r02 === stopAt, 'the stopped pair\'s lone request is released only together with the stop');
  // the full collect gives the same masked events as the stream folded
  const all = collect(cfg).events.filter(e => e.verb === 'dispatch'); assert.deepEqual(all.map(e => e.label).sort(), disp.flat().map((e: any) => e.label).sort());
});

test('live: a held request whose driver died is released at the wall-time limit, with no further write to the manifest', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'office-live-dead-'))); roots.push(root);
  const coord = path.join(root, 'coordination'), dir = path.join(coord, '2026-10-17/date'), man = path.join(dir, 'manifest-compare.jsonl'), cfg: Config = { home: path.join(root, 'home'), room: root, coordination: coord,
    promptKnowledge: path.join(root, 'pk'), roomData: path.join(root, 'rd'), claudeProject: path.join(root, 'proj'), spool: path.join(root, 'spool'), repos: [], work: path.join(root, 'work'), research: path.join(root, 'research'), extra: [] };
  fs.mkdirSync(cfg.claudeProject, { recursive: true }); W(path.join(dir, 'restricted/key.json'), { 'T-1': { traj: 'compare·v0·r01' } });
  const rec = (o: any) => fs.appendFileSync(man, JSON.stringify(o) + '\n'), now = Date.now(), at = (ms: number) => new Date(now + ms).toISOString();
  rec({ at: at(-700e3), kind: 'phase-start', phase: 'compare', trajectories: ['compare·v0·r01', 'compare·v1·r01'] });
  for (const a of ['v0', 'v1']) rec({ at: at(-700e3), kind: 'branch', traj: `compare·${a}·r01`, branch: id() });
  const o = createOffice(cfg, {}), lone = () => o.live['get']().events.filter((e: any) => e.verb === 'dispatch' && e.source === man);
  try {
    // the driver sends v0's request, then dies: 9 min 59.7 s ago, so the 10-minute limit falls 0.3 s from now
    rec({ at: at(-600e3 + 300), kind: 'intent', traj: 'compare·v0·r01', turn: 1, pick: { label: 'Jake' } }); o.live.tick();
    assert.equal(lone().length, 0, 'held while the pair may still complete'); const due = o.live['get']().holdUntil.get(man); assert.ok(due && due > Date.now());
    const size = fs.statSync(man).size; await new Promise(r => setTimeout(r, 450)); o.live.tick();
    assert.equal(fs.statSync(man).size, size, 'nothing was written'); assert.equal(lone().length, 1, 'released at the limit');
    assert.ok(!/·v[01]·/.test(JSON.stringify(lone()))); assert.equal(o.live['get']().holdUntil.has(man), false);
  } finally { o.live.stop(); }
});

test('masking is scoped: an unmasked operation sharing trajectory ids with a masked one shows its own rooms; free text stays masked; any JSON formatting is learned', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'office-spill-'))); roots.push(root);
  const coord = path.join(root, 'coordination'), date = path.join(coord, '2026-10-17/date'), dinner = path.join(root, 'work/dinner'), cfg: Config = { home: path.join(root, 'home'), room: root, coordination: coord,
    promptKnowledge: path.join(root, 'pk'), roomData: path.join(root, 'rd'), claudeProject: path.join(root, 'proj'), spool: path.join(root, 'spool'), repos: [], work: path.join(root, 'work'), research: path.join(root, 'research'), extra: [] };
  fs.mkdirSync(cfg.claudeProject, { recursive: true });
  const lines = (r: string, fmt = (o: any) => JSON.stringify(o)) => ['v0', 'v1'].flatMap((a, i) => [{ at: `2026-10-1${r === 'r02' ? 9 : 7}T20:0${i}:00.000Z`, kind: 'done', traj: `compare·${a}·${r}`, turn: 1, turnId: id() }]).map(fmt).join('\n') + '\n';
  // date: unmasked (valid record); dinner: masked, same ids, and one pair written with spaces and an escaped "·"
  W(path.join(date, 'restricted/key.json'), { 'T-1': { traj: 'compare·v0·r01' } }); W(path.join(date, 'manifest-compare.jsonl'), lines('r01'));
  const lock = JSON.stringify({ at: '2026-10-18T19:00:00Z' }); W(path.join(date, 'labels-lock.json'), lock);
  W(path.join(date, 'restricted/unmask.json'), { operation: '2026-10-17/date', at: '2026-10-18T20:00:00Z', by: 'deniz', labelsLock: { file: 'labels-lock.json', sha256: sha(lock) }, keySha256: sha(fs.readFileSync(path.join(date, 'restricted/key.json'))) });
  W(path.join(dinner, 'restricted/key.json'), { 'T-1': { traj: 'compare·v1·r01' } });
  fs.writeFileSync(path.join(dinner, 'manifest-compare.jsonl'), lines('r01') + lines('r02', o => JSON.stringify(o, null, 0).replace(/":/g, '": ').replace(/·/g, '\\u00b7')));
  W(path.join(coord, '2026-10-17/notes.md'), '# notes\nthe rooms were compare·v0·r01 and compare·v1·r01\n');
  const A = new Allowlist(cfg), Md = maskerFor(A, dinner, 'work/dinner');
  assert.deepEqual(Md.trajs.sort(), ['compare·v0·r01', 'compare·v0·r02', 'compare·v1·r01', 'compare·v1·r02'], 'spaced and escaped records are learned');
  assert.ok(!Md.name('compare·v0·r02').endsWith('room ?'), 'a learned pair gets real room letters');
  const s = await serve(cfg);
  try {
    const ev = async (op: string) => (await s.json('/api/events?op=' + encodeURIComponent(op))).events.filter((e: any) => e.verb === 'turn').map((e: any) => e.label).sort();
    assert.deepEqual(await ev('2026-10-17/date'), ['compare·v0·r01 t1', 'compare·v1·r01 t1'], 'the unmasked operation keeps its own ids');
    const dl = await ev('work/dinner'); assert.equal(dl.length, 4); assert.ok(dl.every((l: string) => /room [AB]/.test(l)), 'the masked one shows room letters: ' + dl);
    const dr = JSON.stringify(await s.json('/api/rooms?op=work/dinner')), da = JSON.stringify(await s.json('/api/rooms?op=2026-10-17/date'));
    assert.ok(!/·v[01]·/.test(dr)); assert.ok(da.includes('compare·v0·r01') && !da.includes('room A'), 'the unmasked fans keep their ids');
    const notes = JSON.stringify(await s.json('/api/expand/file?path=' + encodeURIComponent(path.join(coord, '2026-10-17/notes.md'))));
    assert.ok(!/·v[01]·/.test(notes), 'free text naming a shared id stays masked');
    const all = JSON.stringify(await s.json('/api/events?op=*')); assert.ok(!/compare·v[01]·r02/.test(all), 'dinner-only ids never shown');
  } finally { await s.close(); }
});
