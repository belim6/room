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
  const c = collect(cfg), turnEv = c.events.find(e => e.detailRef.kind === 'manifest-turn')!, s = await serve(cfg);
  try { const x = await s.json('/api/expand/event/' + turnEv.id); assert.ok(x.sections.some((y: any) => y.title === 'room message' && y.allowed === false)); assert.ok(!JSON.stringify(x).includes('TURN-TEXT')); } finally { await s.close(); }
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
