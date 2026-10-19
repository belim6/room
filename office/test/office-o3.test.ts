import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { matchWorkflow, loadTemplates, stepNames, type Template } from '../collect/workflow';
import { Allowlist, type Config } from '../collect/privacy';
import { unmaskState, fans } from '../collect/rooms';
import { collect } from '../collect/index';
import { createOffice } from '../server';

// O3: workflow graph, unmask gate + experiment fans, archive, agent-side narrative.
const OFFICE = path.join(__dirname, '..'), roots: string[] = []; test.after(() => roots.forEach(r => fs.rmSync(r, { recursive: true, force: true })));
let seq = 0;
const E = (o: any) => ({ id: 'e' + (++seq), seq, provenance: 'captured', detailRef: { kind: o.handoff ? 'handoff' : 'x', file: '/f', lines: [] }, source: '/f', derived: false, actor: { id: 'coordinator', kind: 'coordinator', label: 'C' }, ...o });
const crit = (ts: string, outcome: string, slug = 'date-v1') => E({ ts, verb: 'end', outcome, actor: { id: `critic:critic-2026-10-17-${slug}`, kind: 'critic', label: 'critic' }, target: { kind: 'actor', id: 'critic' } });
const write = (ts: string, p: string, op = '2026-10-17/date') => E({ ts, verb: 'write', target: { kind: 'file', id: p, path: p }, operation: op });
function fake(events: any[], artifacts: any[] = []) {
  const actors = new Map<string, any>([['critic:critic-2026-10-17-date-v1', { id: 'critic:critic-2026-10-17-date-v1', kind: 'critic' }], ['driver:d', { id: 'driver:d', kind: 'driver' }]]);
  for (const e of events) if (!actors.has(e.actor.id)) actors.set(e.actor.id, { id: e.actor.id, kind: e.actor.kind });
  return { events, actors, artifacts, allow: { roots: { coordination: '/c' } } } as any;
}
const C = '/c/2026-10-17', D = C + '/date';

test('workflow: the date v1 cycle (two rounds, critic loops ×2 and ×3, lock from its artifact, hollow unmask and Deniz read)', () => {
  const ev = [
    write('2026-10-17T16:59:00Z', `${C}/68-boring-baseline-plan.md`),
    E({ ts: '2026-10-17T16:59:10Z', verb: 'read', actor: { id: 'critic:critic-2026-10-17-return-audit', kind: 'critic' }, target: { kind: 'file', path: `${C}/68-boring-baseline-plan.md` } }), // it read plan 68
    crit('2026-10-17T16:59:30Z', 'no-go', 'return-audit'), write('2026-10-17T17:00:00Z', `${C}/68-boring-baseline-plan.md`), crit('2026-10-17T17:28:00Z', 'go', 'date-dispatch'),
    write('2026-10-17T17:27:00Z', `${D}/hashes.json`),
    E({ ts: '2026-10-17T17:28:26Z', verb: 'spawn', target: { kind: 'actor', id: 'driver:d' }, operation: '2026-10-17/date/run-baseline' }),
    E({ ts: '2026-10-17T17:42:20Z', verb: 'end', outcome: 'verdict', actor: { id: 'agent:l1', kind: 'labeler' }, operation: '2026-10-17/date/labeling' }),
    write('2026-10-17T17:44:00Z', `${C}/70-date-baseline-results.md`),
    write('2026-10-17T19:58:00Z', `${C}/71-date-v1-proposal.md`),
    crit('2026-10-17T19:59:00Z', 'no-go'), crit('2026-10-17T20:01:00Z', 'no-go', 'date-v1-recheck'), crit('2026-10-17T20:02:30Z', 'go', 'date-v1-recheck2'),
    E({ ts: '2026-10-17T20:02:58Z', verb: 'spawn', target: { kind: 'actor', id: 'driver:d' }, operation: '2026-10-17/date/run-compare' }),
    E({ ts: '2026-10-18T19:11:02Z', handoff: true, verb: 'dispatch', label: 'dispatch', target: { kind: 'actor', id: 'role:labelers', path: `${D}/label-freeze-compare.json` }, operation: '2026-10-17/date/labeling-compare' }),
    E({ ts: '2026-10-18T19:12:00Z', verb: 'end', outcome: 'verdict', actor: { id: 'codexrun:x', kind: 'labeler' }, operation: '2026-10-17/date/labeling-compare' }),
  ];
  const arts = [{ path: `${C}/68-boring-baseline-plan.md`, operation: '2026-10-17/date', mtime: '2026-10-17T17:00:00Z' }, { path: `${C}/71-date-v1-proposal.md`, operation: '2026-10-17/date', mtime: '2026-10-17T20:06:00Z' },
    { path: `${D}/labels-lock-baseline.json`, operation: '2026-10-17/date', mtime: '2026-10-17T17:43:23Z' }, { path: `${D}/labels-lock-compare.json`, operation: '2026-10-17/date', mtime: '2026-10-18T19:12:25Z' }];
  const w = matchWorkflow(fake(ev, arts), '2026-10-17/date')!;
  assert.equal(w.template!.id, 'experiment-cycle'); assert.equal(w.rounds.length, 2);
  const st = (r: number, id: string) => w.rounds[r].steps.find((s: any) => s.id === id)!;
  assert.deepEqual(w.rounds.map((r: any) => r.loops[0].verdicts), [['no-go', 'go'], ['no-go', 'no-go', 'go']]);
  assert.deepEqual(w.rounds.map((r: any) => r.loops[0].count), [2, 3]);
  assert.equal(st(0, 'fix').status, 'done', 'plan 68 amendments'); assert.equal(st(1, 'recheck').heuristic, 2);
  for (const r of [0, 1]) { assert.equal(st(r, 'dispatch').status, 'done'); assert.equal(st(r, 'label').status, 'done'); assert.equal(st(r, 'lock').status, 'done'); assert.equal(st(r, 'unmask').status, 'hollow'); assert.equal(st(r, 'deniz-read').status, 'hollow'); }
  assert.deepEqual(st(1, 'lock').evidence, [`${D}/labels-lock-compare.json`], 'lock evidenced by its artifact');
  assert.equal(w.unplanned.length, 0);
});

test('workflow: direct vs heuristic, the unplanned lane, and loop counts that exclude ambiguous events', () => {
  const tpl: Template = { id: 't', title: 'T', applies: '^op$', round: 'a', steps: [
    { id: 'a', title: 'A', rules: [{ verb: 'write', file: '/01-a\\.md$', newPacket: true }] },
    { id: 'r1', title: 'review', loop: 'L', rules: [{ actorKind: 'critic', verb: 'end' }] },
    { id: 'r2', title: 'also review', rules: [{ actorKind: 'critic', verb: 'end', after: 'r1' }] }, // overlaps r1 once r1 happened: ambiguous
    { id: 'z', title: 'Z', rules: [{ verb: 'write', file: '/z\\.md$' }] }], loops: [{ id: 'L', steps: ['r1'], title: 'review loop', count: ['r1'] }] };
  const ev = [write('2026-01-01T00:00:00Z', '/c/01-a.md', 'op'), E({ ts: '2026-01-01T00:00:30Z', verb: 'read', actor: { id: 'critic:critic-x', kind: 'critic' }, target: { kind: 'file', path: '/c/01-a.md' } }), crit('2026-01-01T00:01:00Z', 'no-go'), crit('2026-01-01T00:02:00Z', 'go'),
    E({ ts: '2026-01-01T00:03:00Z', handoff: true, step: 'r1', verb: 'message', label: 'review', operation: 'op', actor: { id: 'critic', kind: 'critic' } }),
    E({ ts: '2026-01-01T00:04:00Z', handoff: true, verb: 'block', label: 'blocked', operation: 'op' })];
  ev.forEach(e => (e.operation ??= 'op')); ev[2].actor.id = ev[3].actor.id = 'critic:critic-x';
  const w = matchWorkflow(fake(ev, [{ path: '/c/01-a.md', operation: 'op', mtime: '2026-01-01T00:00:00Z' }]), 'op', [tpl])!;
  const r = w.rounds[0], s = (id: string) => r.steps.find((x: any) => x.id === id)!;
  assert.equal(s('r1').heuristic, 1); assert.equal(s('r1').direct, 1, 'the events.jsonl step is a direct match');
  assert.deepEqual(w.unplanned.map((u: any) => [u.reason, u.candidates]), [['ambiguous', ['r1', 'r2']], ['no step fits', undefined]]);
  assert.deepEqual([r.loops[0].count, r.loops[0].direct, r.loops[0].heuristic], [2, 1, 1], 'the ambiguous verdict is not counted');
  assert.equal(s('z').status, 'hollow'); assert.ok(r.steps.find((x: any) => x.current), 'the latest step is current');
  // the shipped templates and their step names (what the coordinator writes into events.jsonl `step`)
  const names = stepNames(); assert.deepEqual(Object.keys(names).sort(), ['build-release', 'experiment-cycle', 'labeling']);
  for (const t of loadTemplates()) for (const l of t.loops) for (const st of [...l.steps, ...l.count]) assert.ok(names[t.id].includes(st), `${t.id}: loop names ${st}`);
});

// ---- unmask gate (amendment P1 + recheck P2) ------------------------------------------------------------------------------
const sha = (b: string | Buffer) => crypto.createHash('sha256').update(b).digest('hex');
function opFolder() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'office-o3-'))); roots.push(root);
  const coord = path.join(root, 'coordination'), dir = path.join(coord, '2026-10-17/date'); fs.mkdirSync(path.join(dir, 'restricted'), { recursive: true });
  const key = JSON.stringify({ 'T-11111111': { traj: 'compare·v0·r01' }, 'T-22222222': { traj: 'compare·v1·r01' } }); fs.writeFileSync(path.join(dir, 'restricted/key.json'), key);
  const lock = JSON.stringify({ locked: true, at: '2026-10-18T19:12:25.565Z' }); fs.writeFileSync(path.join(dir, 'labels-lock-compare.json'), lock);
  const man = ['compare·v0·r01', 'compare·v1·r01'].flatMap((t, k) => [1, 2].flatMap(n => [JSON.stringify({ at: `2026-10-17T20:0${n}:0${k}Z`, kind: 'intent', traj: t, turn: n, pick: { label: n % 2 ? 'Jake' : 'Megan' } }),
    JSON.stringify({ at: `2026-10-17T20:0${n}:3${k}Z`, kind: 'done', traj: t, turn: n, turnId: `t${k}${n}`, outputRevision: 'r' })]));
  fs.writeFileSync(path.join(dir, 'manifest-compare.jsonl'), man.join('\n') + '\n');
  const cfg: Config = { home: path.join(root, 'home'), coordination: coord, promptKnowledge: path.join(root, 'pk'), roomData: path.join(root, 'rd'), claudeProject: path.join(root, 'proj'), spool: path.join(root, 'spool'), repos: [] };
  const good = { operation: '2026-10-17/date', at: '2026-10-18T20:00:00Z', by: 'claude', labelsLock: { file: 'labels-lock-compare.json', sha256: sha(lock) }, keySha256: sha(key) };
  const put = (u: unknown) => fs.writeFileSync(path.join(dir, 'restricted/unmask.json'), typeof u === 'string' ? u : JSON.stringify(u));
  return { root, dir, cfg, good, put, lock };
}
test('unmask gate: valid record unmasks; missing, malformed, mismatched and escaping records stay masked', () => {
  const { root, dir, cfg, good, put } = opFolder(), al = new Allowlist(cfg), st = () => unmaskState(al, dir, '2026-10-17/date');
  assert.equal(st().valid, false); assert.match(st().reason, /no unmask record/);
  put(good); assert.equal(st().valid, true, st().reason);
  const bad: [string, unknown][] = [
    ['not JSON', '{"operation":'], ['array', '[]'], ['other operation', { ...good, operation: '2026-10-11/dinner' }], ['sub-operation', { ...good, operation: '2026-10-17/date/labeling' }],
    ['no at', { ...good, at: 'yesterday' }], ['no by', { ...good, by: '' }], ['key mismatch', { ...good, keySha256: 'a'.repeat(64) }], ['lock missing', { ...good, labelsLock: undefined }],
    ['lock hash', { ...good, labelsLock: { file: 'labels-lock-compare.json', sha256: 'b'.repeat(64) } }], ['lock malformed', { ...good, labelsLock: { file: 'labels-lock-compare.json', sha256: 'xyz' } }],
    ['escape ..', { ...good, labelsLock: { file: '../other/labels-lock.json', sha256: good.labelsLock.sha256 } }], ['absolute', { ...good, labelsLock: { file: path.join(dir, 'labels-lock-compare.json'), sha256: good.labelsLock.sha256 } }],
    ['not later', { ...good, at: '2026-10-18T19:00:00Z' }], ['response lock missing file', { ...good, responseLock: { file: 'nope.json', sha256: 'c'.repeat(64) } }],
  ];
  for (const [why, u] of bad) { put(u); assert.equal(st().valid, false, why); }
  // a lock path that escapes through a symlink, with a hash that matches the escaped file
  const other = path.join(root, 'elsewhere.json'); fs.writeFileSync(other, JSON.stringify({ at: '2026-10-18T19:00:00Z' })); fs.symlinkSync(other, path.join(dir, 'link-lock.json'));
  put({ ...good, labelsLock: { file: 'link-lock.json', sha256: sha(fs.readFileSync(other)) } }); assert.equal(st().valid, false, 'symlink escape');
  // an unmask record in the wrong folder (the parent) doesn't count for this operation
  put({ ...good, operation: '2026-10-17' }); assert.equal(unmaskState(al, path.dirname(dir), '2026-10-17').valid, false);
});
test('arms are masked before a valid unmask record: fans, labels, Expand and files; shown after', async () => {
  const { dir, cfg, good, put } = opFolder(), al = new Allowlist(cfg);
  const masked = fans(al, [], dir, '2026-10-17/date')[0];
  assert.equal(masked.masked, true); assert.deepEqual(masked.pairs.map((p: any) => p.pair), ['compare·r01']);
  assert.deepEqual(masked.pairs[0].lanes.map((l: any) => l.name).sort(), ['compare·r01·room A', 'compare·r01·room B']); assert.ok(masked.pairs[0].lanes.every((l: any) => l.ticks.length === 2 && !('traj' in l)));
  assert.deepEqual(masked.pairs[0].lanes[0].ticks.map((t: any) => t.speaker), ['Jake', 'Megan']);
  const o = createOffice(cfg), srv = o.app.listen(0, '127.0.0.1'); await new Promise(r => srv.once('listening', r));
  try {
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, t = async (u: string) => (await fetch(base + u)).text();
    let all = await t('/api/events?op=*') + await t('/api/rooms?op=2026-10-17/date') + await t('/api/summary');
    for (const e of JSON.parse(await t('/api/events?op=*')).events) all += await t('/api/expand/event/' + e.id);
    for (const f of ['manifest-compare.jsonl', 'restricted/key.json', 'restricted/unmask.json']) all += await t('/api/expand/file?path=' + encodeURIComponent(path.join(dir, f)));
    assert.ok(!/·v[01]·/.test(all), 'no arm id leaves the server while masked'); assert.ok(all.includes('room A'));
  } finally { await new Promise(r => srv.close(r)); }
  put(good); const un = fans(new Allowlist(cfg), [], dir, '2026-10-17/date')[0];
  assert.equal(un.masked, false); assert.deepEqual(un.pairs[0].lanes.map((l: any) => l.name).sort(), ['compare·v0·r01', 'compare·v1·r01']);
  assert.equal(new Allowlist(cfg).read(path.join(dir, 'restricted/key.json')).allowed, false, 'restricted/ stays path-only even when unmasked');
});

// ---- archive and narrative ----------------------------------------------------------------------------------------------
test('agent narrative: deterministic templates over events, never the agent prose', async () => {
  const M: any = await import(path.join(OFFICE, 'web/model.mjs')), n = (id: string) => id === 'codexrun:x' ? 'labeler · Codex · date labeling · T-1a2b3c4d' : id;
  const a = { id: 'codexrun:x', kind: 'labeler', label: 'x' }, f = (p: string) => ({ kind: 'file', path: p });
  const ev = [{ ts: '2026-10-18T10:00:00Z', verb: 'spawn', actor: { id: 'coordinator' }, target: { kind: 'actor', id: 'codexrun:x' } },
    ...['/d/labeler-prompt.md', '/d/blind/T-1a2b3c4d.md', '/d/rubric-v1.1.md'].map((p, i) => ({ ts: `2026-10-18T10:00:0${i + 2}Z`, verb: 'read', actor: a, target: f(p), label: 'PROSE-IN-LABEL' })),
    { ts: '2026-10-18T10:00:41Z', verb: 'end', actor: a, outcome: 'verdict', label: 'PROSE-IN-LABEL' }];
  const want = 'labeler · Codex · date labeling · T-1a2b3c4d: read the labeler instructions, transcript T-1a2b3c4d and the rubric; returned its verdict; finished in 41 s.';
  assert.equal(M.agentStory(ev, 'codexrun:x', n), want); assert.equal(M.agentStory(ev, 'codexrun:x', n), want);
  assert.equal(M.agentStory(ev.slice(0, 2), 'codexrun:x', n, Date.parse('2026-10-18T10:00:30Z')), 'labeler · Codex · date labeling · T-1a2b3c4d: read the labeler instructions; working for 30 s so far.');
  assert.ok(!M.agentStory(ev, 'codexrun:x', n).includes('PROSE'));
});
test('archive: artifacts with writer and reader links, searchable by friendly title', async () => {
  const { dir, cfg } = opFolder(); fs.writeFileSync(path.join(path.dirname(dir), '71-date-v1-proposal.md'), '# Date room v1: the bundled revision\n');
  const o = createOffice(cfg), srv = o.app.listen(0, '127.0.0.1'); await new Promise(r => srv.once('listening', r));
  try {
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, a = await (await fetch(base + '/api/archive?op=*&q=bundled')).json();
    assert.deepEqual(a.items.map((x: any) => x.title), ['Date room v1: the bundled revision']);
    const all = await (await fetch(base + '/api/archive?op=*')).json(); assert.ok(all.items.some((x: any) => x.path.endsWith('restricted/key.json') && x.title === 'key'), 'restricted files: name only');
  } finally { await new Promise(r => srv.close(r)); }
  const c = collect(cfg); assert.ok(c.artifacts.length >= 3);
});
