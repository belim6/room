import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { collect } from '../collect/index';
import { config, type Config } from '../collect/privacy';
import { readRegistry, Identity, roleFromTitle } from '../collect/roles';
import { roleLoops } from '../collect/workflow';
import { register } from '../capture/register-session';
import { createOffice } from '../server';

// O4: sessions by role (registry, Desktop titles, unregistered fallback), messages between sessions, work/ + research/ roots,
// the critic as one node, role-to-role loops; plus the O3 release item: Codex privacy P1 on the room feed and operation metadata.
const OFFICE = path.join(__dirname, '..'), roots: string[] = []; test.after(() => roots.forEach(r => fs.rmSync(r, { recursive: true, force: true })));
const sha = (b: string | Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const U = (n: string) => `${n.repeat(8).slice(0, 8)}-${n.repeat(4).slice(0, 4)}-4${n.repeat(3).slice(0, 3)}-8${n.repeat(3).slice(0, 3)}-${n.repeat(12).slice(0, 12)}`;
const A = U('a'), B = U('b'), C = U('c'), D = U('d'), M1 = U('1'), M2 = U('2'), M3 = U('3');

function makeRoot() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'office-o4-'))); roots.push(root);
  for (const d of ['proj', 'coordination/2026-10-17/date', 'work', 'research', 'roles', 'spool', 'home', 'pk', 'rd']) fs.mkdirSync(path.join(root, d), { recursive: true });
  const cfg: Config = { home: path.join(root, 'home'), room: root, coordination: path.join(root, 'coordination'), promptKnowledge: path.join(root, 'pk'), roomData: path.join(root, 'rd'), claudeProject: path.join(root, 'proj'),
    spool: path.join(root, 'spool'), repos: [], work: path.join(root, 'work'), research: path.join(root, 'research'), sessions: path.join(root, 'roles/sessions.json'), extra: [] };
  return { root, cfg };
}
let n = 0;
const line = (sid: string, o: any) => JSON.stringify({ parentUuid: null, isSidechain: false, cwd: '/x', sessionId: sid, uuid: o.uuid || 'u' + (++n), ...o }) + '\n';
const title = (sid: string, t: string) => JSON.stringify({ type: 'custom-title', customTitle: t, sessionId: sid }) + '\n';
const tool = (sid: string, ts: string, id: string, name: string, input: any, result: any, toolUseResult: any = {}, uuid?: string) =>
  line(sid, { type: 'assistant', uuid: uuid ? uuid + '-a' : undefined, timestamp: ts, message: { id: 'm' + id, role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } })
  + line(sid, { type: 'user', uuid: uuid ? uuid + '-r' : undefined, timestamp: ts.replace(/\.\d+Z$/, '.900Z'), toolUseResult, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: typeof result === 'string' ? result : JSON.stringify(result) }] } });
const delivery = (sid: string, ts: string, msgId: string, from: string, name: string, body: string) =>
  line(sid, { type: 'user', isMeta: true, timestamp: ts, origin: { kind: 'peer', from, verifiedPeerPid: 1, msg_id: msgId, name, fromSession: 'local_x', body }, message: { role: 'user', content: 'Another Claude session sent a message: ' + body } });
const user = (sid: string, ts: string, text: string) => line(sid, { type: 'user', timestamp: ts, message: { role: 'user', content: text } });
const server = async (cfg: Config) => { const o = createOffice(cfg), srv = o.app.listen(0, '127.0.0.1'); await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`; return { o, base, text: async (u: string) => (await fetch(base + u)).text(), json: async (u: string) => (await fetch(base + u)).json(), close: () => new Promise(r => srv.close(r)) }; };

// ---- O3 release item: Codex privacy P1 ----------------------------------------------------------------------------------
function maskedOp(root: string) {
  const dir = path.join(root, 'coordination/2026-10-17/date'); fs.mkdirSync(path.join(dir, 'restricted'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'restricted/key.json'), JSON.stringify({ 'T-11111111': { traj: 'compare·v0·r01' } }));
  const B1 = U('e'), man = ['compare·v0·r01', 'compare·v1·r01'].flatMap((t, k) => [JSON.stringify({ at: `2026-10-17T20:00:0${k}Z`, kind: 'branch', traj: t, branch: k ? U('f') : B1 }),
    JSON.stringify({ at: `2026-10-17T20:01:0${k}Z`, kind: 'intent', traj: t, turn: 1, pick: { label: 'Jake' } }), JSON.stringify({ at: `2026-10-17T20:01:3${k}Z`, kind: 'done', traj: t, turn: 1, turnId: U(String(k + 4)) })]);
  fs.writeFileSync(path.join(dir, 'manifest-compare.jsonl'), man.join('\n') + '\n');
  // a day-level packet whose heading names the trajectories: it becomes the operation's packet title (metadata)
  fs.writeFileSync(path.join(root, 'coordination/2026-10-17/71-date-v1-proposal.md'), '# Date v1: compare·v0·r01 against compare·v1·r01\n\nbody\n');
  return { dir, branch: B1 };
}
test('privacy P1: room-feed notices and operation metadata carry no turn text and no unmasked room ids on /api/summary, /api/events or /api/live', async () => {
  const { root, cfg } = makeRoot(), { branch } = maskedOp(root), s = await server(cfg);
  try {
    const ctl = new AbortController(), r = await fetch(s.base + '/api/live', { signal: ctl.signal }), rd = r.body!.getReader(), dec = new TextDecoder(); let sse = '';
    const pump = (async () => { try { for (;;) { const { done, value } = await rd.read(); if (done) break; sse += dec.decode(value); } } catch {} })();
    const TEXT = 'TURN-TEXT-MARKER-the-cat-sat-on-the-mat', turn = U('9');
    // not ids: turn text in the id field, a trajectory id, a path; extra fields carrying text; a bad branch
    for (const n of [{ kind: 'turns', id: TEXT }, { kind: 'turns', id: 'compare·v0·r01' }, { kind: 'turns', id: '../../etc/passwd' }, { kind: 'turns', id: 'a'.repeat(40) },
      { kind: 'revisions', id: turn, text: TEXT }]) s.o.live.notice(n as any);
    s.o.live.notice({ kind: 'turns', id: turn, branch, at: '2026-10-17T20:02:00Z', text: TEXT, traj: 'compare·v1·r01', label: TEXT } as any);
    s.o.live.notice({ kind: 'turns', id: U('8'), branch: 'compare·v0·r01', at: 'not a date' } as any);
    await new Promise(r => setTimeout(r, 150)); ctl.abort(); await pump;
    const summary = await s.text('/api/summary'), events = await s.text('/api/events?op=*'), opEvents = await s.text('/api/events?op=2026-10-17/date'), all = summary + events + opEvents + sse;
    assert.ok(!all.includes('TURN-TEXT-MARKER'), 'no turn text'); assert.ok(!/·v[01]·/.test(all), 'no arm id while masked'); assert.ok(!all.includes('passwd'));
    const live = JSON.parse(events).events.filter((e: any) => e.source === 'room-feed');
    assert.deepEqual(live.map((e: any) => [e.target.id, e.label, e.operation]), [[turn, 'turn (live)', '2026-10-17/date/run-compare'], [U('8'), 'turn (live)', undefined]], 'only UUID notices, fixed label, op only from a known branch');
    const op = JSON.parse(summary).operations.find((o: any) => o.id === '2026-10-17/date'); assert.match(op.packet, /room A|room B/, 'packet heading masked');
    for (const e of live) { const x = await s.json('/api/expand/event/' + e.id); assert.ok(!JSON.stringify(x).includes('TURN-TEXT')); }
  } finally { await s.close(); }
});

// ---- registry, identity --------------------------------------------------------------------------------------------------
test('registry parsing and role resolution: registry > Desktop title > pre-O4 primary > unregistered', () => {
  const { root } = makeRoot(), f = path.join(root, 'roles/sessions.json');
  assert.deepEqual(readRegistry(f), { entries: [], skipped: 0 }, 'missing file: empty, no error');
  fs.writeFileSync(f, '{"version":'); assert.equal(readRegistry(f).error, 'registry is not valid JSON');
  fs.writeFileSync(f, JSON.stringify({ version: 1, entries: [{ session: A, role: 'partner', since: '2026-10-19T10:00:00Z', socket: '/tmp/cc-socks/1.sock' }, { session: A, role: 'operator', since: '2026-10-19T12:00:00Z' },
    { session: 'nope', role: 'partner', since: '2026-10-19T10:00:00Z' }, { session: B, role: 'wizard', since: '2026-10-19T10:00:00Z' }, { session: C, role: 'critic', since: 'yesterday' }] }));
  const r = readRegistry(f); assert.equal(r.entries.length, 2); assert.equal(r.skipped, 3);
  fs.writeFileSync(f, JSON.stringify({ sessions: { [B]: { role: 'housekeeper', since: '2026-10-19T09:00:00Z' } } })); assert.deepEqual(readRegistry(f).entries.map(e => e.role), ['housekeeper'], 'hand-kept map (fallback)');
  const id = new Identity(r.entries, D);
  assert.deepEqual(id.roleAt(A, '2026-10-19T09:00:00Z'), { role: 'partner', via: 'registry' }, 'the first registration covers the moments before it');
  assert.deepEqual(id.roleAt(A, '2026-10-19T13:00:00Z', 'secretary'), { role: 'operator', via: 'registry' }, 'registry beats the title; a later entry applies from its since');
  assert.deepEqual(id.roleAt(B, '2026-10-19T13:00:00Z', 'experimenter1'), { role: 'experimenter', via: 'title' });
  assert.deepEqual(id.roleAt(D, '2026-10-19T13:00:00Z', 'brainstorm'), { role: 'coordinator', via: 'primary' });
  assert.deepEqual(id.roleAt(C, '2026-10-19T13:00:00Z', 'Coordination folder overview'), { via: 'none' });
  assert.equal(id.sessionFor('uds:/tmp/cc-socks/1.sock'), A, 'registered socket');
  for (const [t, want] of [['partner', 'partner'], ['Operator', 'operator'], ['experimenter2', 'experimenter'], ['critic 2', 'critic'], ['Jev correspondent', 'jev-correspondent'], ['jev-correspondent', 'jev-correspondent'], ['intern 3', 'intern'], ['Brainstormer', 'brainstormer'], ['experiment2', undefined], ['brainstorm', undefined], ['Room experiments', undefined]] as const) assert.equal(roleFromTitle(t), want, t);
});

test('register-session: the only writer; appends, is idempotent, and refuses rather than guesses', () => {
  const { root } = makeRoot(), f = path.join(root, 'roles/sessions.json'), env = { OFFICE_ROOM: root, OFFICE_HOME: path.join(root, 'home'), CLAUDE_CODE_SESSION_ID: A, CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/cc-socks/42.sock' };
  const before = fs.readdirSync(root).sort();
  assert.equal(register(['wizard'], env).code, 2); assert.equal(register(['partner'], { ...env, CLAUDE_CODE_SESSION_ID: '' }).code, 2); assert.ok(!fs.existsSync(f), 'nothing written on refusal');
  assert.match(register(['partner', '--note', 'first'], env, '2026-10-19T10:00:00.000Z').out, /registered: session aaaaaaaa is the partner/);
  assert.match(register(['partner'], env, '2026-10-19T10:01:00.000Z').out, /already registered/);
  assert.match(register(['operator'], env, '2026-10-19T11:00:00.000Z').out, /was partner/);
  const reg = JSON.parse(fs.readFileSync(f, 'utf8')); assert.equal(reg.version, 1);
  assert.deepEqual(reg.entries.map((e: any) => [e.session, e.role, e.since, e.socket, e.by]), [[A, 'partner', '2026-10-19T10:00:00.000Z', '/tmp/cc-socks/42.sock', 'register-session'], [A, 'operator', '2026-10-19T11:00:00.000Z', '/tmp/cc-socks/42.sock', 'register-session']]);
  assert.deepEqual(readRegistry(f).entries.map(e => e.role), ['partner', 'operator'], 'the Office reads what the command writes');
  assert.deepEqual(fs.readdirSync(root).sort(), before, 'no file outside roles/'); assert.deepEqual(fs.readdirSync(path.join(root, 'roles')), ['sessions.json'], 'no temp or lock left');
  fs.writeFileSync(f, JSON.stringify({ [B]: { role: 'housekeeper', since: '2026-10-19T09:00:00Z' } })); const hand = fs.readFileSync(f, 'utf8');
  assert.equal(register(['partner'], env).code, 1); assert.equal(fs.readFileSync(f, 'utf8'), hand, 'a hand-kept file is never rewritten');
  // the shell entry point works end to end
  const { execFileSync } = require('node:child_process'); fs.rmSync(f);
  const out = execFileSync(path.join(OFFICE, 'bin/register-session'), ['housekeeper'], { env: { ...process.env, ...env, CLAUDE_CODE_SESSION_ID: B } }).toString();
  assert.match(out, /session bbbbbbbb is the housekeeper/); assert.equal(readRegistry(f).entries[0].session, B);
});
test('register-session accepts the roles added on 2026-10-26, and they become labelled role nodes', () => {
  const { root } = makeRoot(), f = path.join(root, 'roles/sessions.json'), base = { OFFICE_ROOM: root, OFFICE_HOME: path.join(root, 'home') };
  const S = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
  ['jev-correspondent', 'brainstormer', 'intern', 'intern'].forEach((r, i) => assert.match(register([r], { ...base, CLAUDE_CODE_SESSION_ID: S[i] }, `2026-10-26T1${i}:00:00.000Z`).out, new RegExp(`is the ${r}`)));
  assert.deepEqual(readRegistry(f).entries.map(e => e.role), ['jev-correspondent', 'brainstormer', 'intern', 'intern']);
  const id = new Identity(readRegistry(f).entries), sink: any = { actors: new Map(), actor(a: any) { this.actors.set(a.id, a); } };
  for (const s of S) id.actorAt(s, '2026-10-26T15:00:00.000Z'); id.apply(sink);
  assert.deepEqual([...sink.actors.values()].map((a: any) => [a.id, a.label, a.sessions.length]).sort(), [['role:brainstormer', 'Brainstormer', 1], ['role:intern', 'Intern', 2], ['role:jev-correspondent', 'Jev correspondent', 1]]);
  // hyphenated role ids count as role nodes for hand-offs and loops (review, 2026-10-26)
  const ev = (n: number, from: string, to: string) => ({ id: 'h' + n, seq: n, ts: `2026-10-26T1${n}:00:00.000Z`, actor: { id: from }, verb: 'message', target: { kind: 'actor', id: to }, operation: 'work/jev', detailRef: { kind: 'handoff' }, provenance: 'captured', source: 't', derived: false });
  const W = require('../collect/workflow'), c: any = { events: [ev(1, 'role:jev-correspondent', 'critic'), ev(2, 'critic', 'role:jev-correspondent')] };
  assert.deepEqual(W.roleHandoffs(c, 'work/jev').map((h: any) => [h.from, h.to]), [['role:jev-correspondent', 'critic'], ['critic', 'role:jev-correspondent']]);
});

// ---- sessions as role nodes, messages between them -------------------------------------------------------------------------
function sessionsFixture() {
  const { root, cfg } = makeRoot(), P = cfg.claudeProject;
  // A: the partner (registered, with its socket). D: a fork of A (copies A's records, same uuids, then its own tail).
  fs.writeFileSync(cfg.sessions!, JSON.stringify({ version: 1, entries: [{ session: A, role: 'partner', since: '2026-10-19T15:10:00Z', socket: '/tmp/cc-socks/75537.sock' }] }));
  const aBody = user(A, '2026-10-19T15:00:00.000Z', 'deniz: brief the operator') + tool(A, '2026-10-19T15:18:21.000Z', 'toolu_send1', 'SendMessage', { to: 'operator', summary: 'SUMMARY-MARKER', message: `Brief: see ${path.join(root, 'work/file-reorganisation/README.md')}` }, { success: true, msg_id: M1 }, { success: true, msg_id: M1 }, 'a-send1')
    + tool(A, '2026-10-19T15:30:00.000Z', 'toolu_w1', 'Write', { file_path: path.join(root, 'research/topic-x/commission.md'), content: '# Commission: who keeps the room alive\n' }, 'ok', {}, 'a-w1');
  fs.writeFileSync(path.join(P, A + '.jsonl'), title(A, 'Chat session') + aBody);
  fs.writeFileSync(path.join(P, D + '.jsonl'), title(D, 'partner') + user(D, '2026-10-19T16:41:00.000Z', 'continue') + aBody + tool(D, '2026-10-19T16:42:00.000Z', 'toolu_d1', 'Read', { file_path: path.join(root, 'work/file-reorganisation/README.md') }, '# x', {}, 'd-r1'));
  // B: titled "operator" in Desktop; receives M1; replies to A's socket (no delivery on file: resolved through the registry socket)
  fs.writeFileSync(path.join(P, B + '.jsonl'), user(B, '2026-10-19T15:14:05.000Z', 'you are the operator') + title(B, 'Fresh-start draft roles') + title(B, 'operator')
    + delivery(B, '2026-10-19T15:18:22.000Z', M1, 'uds:/tmp/cc-socks/75537.sock', 'partner', 'Brief from the partner')
    + tool(B, '2026-10-19T15:24:37.000Z', 'toolu_send2', 'SendMessage', { to: 'uds:/tmp/cc-socks/75537.sock', message: 'done: work/file-reorganisation/migration-map.md' }, { success: true, msg_id: M2 }, { success: true, msg_id: M2 }));
  // C: no role anywhere (unregistered); gets a message from a session whose transcript is elsewhere, named "housekeeper"
  fs.writeFileSync(path.join(P, C + '.jsonl'), title(C, 'Coordination folder overview') + user(C, '2026-10-19T12:00:00.000Z', 'hi') + delivery(C, '2026-10-19T16:46:41.000Z', M3, 'uds:/tmp/cc-socks/999.sock', 'housekeeper', 'From the housekeeper: shred list'));
  fs.mkdirSync(path.join(root, 'work/file-reorganisation'), { recursive: true });
  fs.writeFileSync(path.join(root, 'work/file-reorganisation/README.md'), "# File reorganisation: from the old layout to ROOM.md's hierarchy\n\n**Status:** phase 1 **done** 2026-10-19. Next: phase 2.\n");
  fs.mkdirSync(path.join(root, 'research/topic-x'), { recursive: true }); fs.writeFileSync(path.join(root, 'research/topic-x/commission.md'), '# Commission: who keeps the room alive\n');
  fs.writeFileSync(path.join(root, 'research/topic-x/synthesis.md'), '# Synthesis: rooms that keep themselves alive\n'); fs.utimesSync(path.join(root, 'research/topic-x/synthesis.md'), new Date('2026-10-19T17:00:00Z'), new Date('2026-10-19T17:00:00Z'));
  return { root, cfg };
}
test('sessions by role: registry and Desktop titles name the nodes; forks count once; unregistered sessions stay "session ‹id›"', () => {
  const { cfg } = sessionsFixture(), c = collect(cfg), act = (id: string) => c.actors.get(id) as any;
  assert.equal(act('role:partner').kind, 'partner'); assert.equal(act('role:partner').label, 'Partner'); assert.equal(act('role:partner').permanent, true);
  assert.deepEqual(act('role:partner').sessions.map((s: any) => [s.id, s.via]), [[A, 'registry'], [D, 'title']], 'the fork is the partner\'s successor session');
  assert.deepEqual(act('role:operator').sessions.map((s: any) => [s.id, s.via]), [[B, 'title']], 'renamed to "operator" within minutes: the role from its start');
  assert.ok(!c.actors.has('session:' + B.slice(0, 8)), 'no leftover unregistered node for B');
  const un = act('session:cccccccc'); assert.equal(un.unregistered, true); assert.equal(un.kind, 'session'); assert.equal(un.name, 'session ‹cccccccc› (unregistered)');
  const sends = c.events.filter(e => e.detailRef.key === 'toolu_send1'); assert.equal(sends.length, 1, 'the fork\'s copy of the send is not a second event');
  assert.ok(c.sources.some(s => s.path.endsWith(D + '.jsonl') && /repeat an earlier session/.test((s as any).note || '')));
  assert.ok(c.events.some(e => e.detailRef.key === 'toolu_d1' && e.actor.id === 'role:partner'), 'the fork\'s own tail is the partner');
  assert.ok(!c.events.some(e => e.actor.id === 'deniz' && e.detailRef.kind === 'claude-user' && /\b(15:18:22|16:46:41)/.test(e.ts)), 'a delivered message is not Deniz');
});
test('messages between sessions: send ↔ delivery by msg_id (captured), by socket or name (derived), delivery-only (derived); labelled edges; loops', async () => {
  const { cfg } = sessionsFixture(), c = collect(cfg), peer = c.events.filter(e => /^peer/.test(e.label || '')).sort((a, b) => a.ts.localeCompare(b.ts));
  assert.deepEqual(peer.map(e => [e.actor.id, e.target!.id, e.label, e.provenance, e.outcome]), [
    ['role:partner', 'role:operator', 'peer', 'captured', 'delivered'],
    ['role:operator', 'role:partner', 'peer-reply', 'derived', 'ok'],
    ['role:housekeeper', 'session:cccccccc', 'peer', 'derived', 'delivered']]);
  assert.equal(peer[0].operation, 'work/file-reorganisation', 'operation from the paths the message names');
  const M: any = await import(path.join(OFFICE, 'web/model.mjs')), nameOf = (id: string) => (c.actors.get(id) as any)?.name || c.actors.get(id)?.label || id, opT = (id: string) => c.operations.find(o => o.id === id)?.title || id;
  assert.equal(peer[0].opInferred, true); assert.equal(M.edgeSummary(peer[0], nameOf, opT), 'asks Operator', 'an inferred topic is dropped (review P2)');
  assert.equal(M.edgeSummary(peer[1], nameOf, opT), 'replies to Partner');
  assert.equal(M.edgeSummary({ ...peer[0], opInferred: false }, nameOf, opT), "asks Operator: File reorganisation: from the old layout to ROOM.md's hierarchy", 'an explicit operation keeps its topic');
  assert.equal(M.narrate(peer[0], nameOf, opT), 'Partner asked Operator.'); assert.equal(M.narrate(peer[2], nameOf, opT), 'Housekeeper asked session ‹cccccccc› (unregistered) (derived).');
  const loops = roleLoops(c, '*').loops.map(l => [l.title, l.count, l.direct, l.heuristic]);
  assert.deepEqual(loops.find(l => l[0] === 'Partner → Operator → Partner'), ['Partner → Operator → Partner', 1, 0, 1], 'one loop; heuristic because the reply was resolved by socket');
  assert.deepEqual(loops.find(l => l[0] === 'Partner → PSRI (research) → Partner'), ['Partner → PSRI (research) → Partner', 1, 0, 1], 'research commission and delivery');
  // agent-written SendMessage summary never reaches a label or the metadata tier
  const s = await server(cfg); try { const all = await s.text('/api/summary') + await s.text('/api/events?op=*') + await s.text('/api/workflow?op=*'); assert.ok(!all.includes('SUMMARY-MARKER'));
    const w = await s.json('/api/workflow?op=work/file-reorganisation'); assert.equal(w.workflow.template, null); assert.equal(w.workflow.roleLoops.loops[0].title, 'Partner → Operator → Partner');
  } finally { await s.close(); }
});
test('research/: a commission draws an edge to PSRI and a synthesis in that folder an edge back to whoever commissioned it', () => {
  const { cfg } = sessionsFixture(), c = collect(cfg), r = c.events.filter(e => e.detailRef.kind === 'research');
  assert.deepEqual(r.map(e => [e.actor.id, e.target!.id, e.label, e.target!.title, e.operation]), [
    ['role:partner', 'psri', 'commission', 'Commission: who keeps the room alive', 'research/topic-x'], ['psri', 'role:partner', 'delivery', 'Synthesis: rooms that keep themselves alive', 'research/topic-x']]);
  assert.equal(c.actors.get('psri')?.permanent, true);
});

// ---- work/ as operations; the new roots; restricted/ under work -------------------------------------------------------------
test('work/<thing> folders are operations (README title; status in the archive); coordination/ operations still render; roots are configurable', async () => {
  const { root, cfg } = sessionsFixture(); fs.writeFileSync(path.join(root, 'coordination/2026-10-17/date/70-plan.md'), '# plan\n');
  fs.appendFileSync(path.join(cfg.claudeProject, A + '.jsonl'), tool(A, '2026-10-17T17:00:00.000Z', 'toolu_old', 'Write', { file_path: path.join(root, 'coordination/2026-10-17/date/70-plan.md'), content: '# plan' }, 'ok'));
  const c = collect(cfg), ops = new Map(c.operations.map(o => [o.id, o]));
  assert.equal(ops.get('work/file-reorganisation')?.title, "File reorganisation: from the old layout to ROOM.md's hierarchy");
  assert.ok(ops.has('2026-10-17/date'), 'the old coordination/ operation still renders');
  assert.ok(c.artifacts.some(a => a.path.endsWith('work/file-reorganisation/README.md') && a.group === 'work' && a.operation === 'work/file-reorganisation'));
  const s = await server(cfg); try {
    const a = await s.json('/api/archive?op=work/file-reorganisation'); assert.equal(a.status['work/file-reorganisation'], 'phase 1 done 2026-10-19. Next: phase 2.');
    assert.equal((await s.json('/api/expand/file?path=' + encodeURIComponent(path.join(root, 'work/file-reorganisation/README.md')))).allowed, true);
  } finally { await s.close(); }
  // phase 2: coordination/ moved to archive/coordination/ is picked up without an env change; env overrides still win
  const r2 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'office-o4-cfg-'))); roots.push(r2); fs.mkdirSync(path.join(r2, 'archive/coordination'), { recursive: true });
  assert.equal(config({ OFFICE_ROOM: r2, OFFICE_HOME: r2 } as any).coordination, path.join(r2, 'archive/coordination'));
  fs.mkdirSync(path.join(r2, 'coordination')); assert.equal(config({ OFFICE_ROOM: r2, OFFICE_HOME: r2 } as any).coordination, path.join(r2, 'coordination'));
  assert.equal(config({ OFFICE_ROOM: r2, OFFICE_HOME: r2, OFFICE_COORDINATION: '/elsewhere', OFFICE_WORK: '/w', OFFICE_RESEARCH: '/r', OFFICE_SESSIONS: '/s.json' } as any).sessions, '/s.json');
});
test('restricted/ under work/ stays path-only and the unmask rule applies per work folder', async () => {
  const { root, cfg } = makeRoot(), dir = path.join(root, 'work/date-room'), run = path.join(dir, 'runs/v1'); fs.mkdirSync(path.join(dir, 'restricted'), { recursive: true }); fs.mkdirSync(run, { recursive: true });
  const key = JSON.stringify({ 'T-1': { traj: 'compare·v0·r01' } }), lock = JSON.stringify({ at: '2026-10-19T10:00:00Z' });
  fs.writeFileSync(path.join(dir, 'restricted/key.json'), key); fs.writeFileSync(path.join(dir, 'labels-lock.json'), lock); fs.writeFileSync(path.join(dir, 'README.md'), '# Date room\n');
  fs.writeFileSync(path.join(run, 'manifest-compare.jsonl'), ['compare·v0·r01', 'compare·v1·r01'].map((t, k) => JSON.stringify({ at: `2026-10-19T09:0${k}:00Z`, kind: 'done', traj: t, turn: 1, turnId: U(String(k + 1)) })).join('\n') + '\n');
  fs.writeFileSync(path.join(run, 'driver-state.json'), JSON.stringify({ trajectories: { 'compare·v0·r01': {} } }));
  let s = await server(cfg);
  try {
    let all = await s.text('/api/summary') + await s.text('/api/events?op=*') + await s.text('/api/rooms?op=work/date-room');
    for (const e of (await s.json('/api/events?op=*')).events) all += await s.text('/api/expand/event/' + e.id);
    for (const f of ['runs/v1/manifest-compare.jsonl', 'runs/v1/driver-state.json', 'restricted/key.json']) all += await s.text('/api/expand/file?path=' + encodeURIComponent(path.join(dir, f)));
    assert.ok(!/·v[01]·/.test(all), 'masked'); assert.ok(all.includes('room A'));
    assert.equal((await s.json('/api/rooms?op=work/date-room')).runs[0].masked, true); assert.equal((await s.json('/api/rooms?op=work/..')).runs.length, 0, 'no traversal through the op id');
  } finally { await s.close(); }
  fs.writeFileSync(path.join(dir, 'restricted/unmask.json'), JSON.stringify({ operation: 'work/date-room', at: '2026-10-19T11:00:00Z', by: 'deniz', labelsLock: { file: 'labels-lock.json', sha256: sha(lock) }, keySha256: sha(key) }));
  s = await server(cfg);
  try { const r = await s.json('/api/rooms?op=work/date-room'); assert.equal(r.runs[0].masked, false); assert.deepEqual(r.runs[0].pairs[0].lanes.map((l: any) => l.name).sort(), ['compare·v0·r01', 'compare·v1·r01']);
    assert.equal((await s.json('/api/expand/file?path=' + encodeURIComponent(path.join(dir, 'restricted/key.json')))).allowed, false, 'restricted/ stays path-only when unmasked');
  } finally { await s.close(); }
});

// ---- the critic as one node --------------------------------------------------------------------------------------------------
test('critic: every critic run attaches to one persistent node; its Codex sessions are listed, a new thread is the successor; caller → critic → caller', () => {
  const { cfg } = sessionsFixture(), sp = path.join(cfg.spool!, 'codex-2026-10-19.jsonl'), T1 = '01a15421-320d-7b80-aff8-1c1e540d0d0c', T2 = '01a154a3-1f2c-78a3-9dd2-e564ada57e7a';
  const recs = (run: string, at: number, thread: string, verdict: string, caller?: string) => [
    { v: 1, src: 'codex', ts: `2026-10-19T16:4${at}:00.000Z`, run, seq: 0, kind: 'start', role: 'critic', label: 'critic', operation: 'work/office', cwd: '/x', id: run + ':start', args: [], ...(caller ? { caller } : {}) },
    { v: 1, src: 'codex', ts: `2026-10-19T16:4${at}:01.000Z`, run, seq: 1, type: 'thread.started', thread, id: run + ':1' },
    { v: 1, src: 'codex', ts: `2026-10-19T16:4${at}:30.000Z`, run, seq: 2, kind: 'end', role: 'critic', operation: 'work/office', exit: { code: 0, signal: null }, id: run + ':end', sections: [{ title: 'final message', prose: true, text: `**Ruling: ${verdict}**` }] }];
  fs.writeFileSync(sp, [...recs('r1', 1, T1, 'NO-GO', A), ...recs('r2', 3, T2, 'GO', A), ...recs('r3', 5, T2, 'GO')].map(r => JSON.stringify(r)).join('\n') + '\n');
  const c = collect(cfg), crit = c.actors.get('critic') as any;
  assert.deepEqual(crit.sessions.map((s: any) => [s.id, s.via]), [[T1, 'codex'], [T2, 'codex']]); assert.ok(!c.actors.has('codexrun:r1'), 'no per-run node');
  const ends = c.events.filter(e => e.actor.id === 'critic' && e.verb === 'end'); assert.deepEqual(ends.map(e => [e.outcome, e.target!.id]), [['no-go', 'role:partner'], ['go', 'role:partner'], ['go', 'coordinator']], 'three rulings, none deduped');
  const asks = c.events.filter(e => e.target?.id === 'critic' && e.verb === 'message'); assert.deepEqual(asks.map(e => [e.actor.id, e.provenance]), [['role:partner', 'captured'], ['role:partner', 'captured'], ['coordinator', 'inferred']]);
  const l = roleLoops(c, 'work/office').loops.find(x => x.title === 'Partner → Critic (Codex) → Partner')!; assert.equal(l.count, 2); assert.equal(l.direct, 2);
});
