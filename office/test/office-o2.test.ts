import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { collect } from '../collect/index';
import { Allowlist, type Config } from '../collect/privacy';
import { Sink } from '../collect/types';
import { parseSpool } from '../collect/spool';
import { hookRecord, codexRecord, append } from '../capture/sanitize.ts';
import { simulate, writeAll } from '../capture/simulate.ts';
import { createOffice } from '../server';

// O2: live capture (hook + spool + office-codex), tailing/SSE, focus, follow, narration. Same fixture tree as O1.
const FIX = path.join(__dirname, 'fixtures'), S = '83d97c5f-df8e-4f7d-a0d0-63a07139e561', OFFICE = path.join(__dirname, '..');
const roots: string[] = []; test.after(() => roots.forEach(r => fs.rmSync(r, { recursive: true, force: true })));
const SECRET = { key: 'sk-' + 'ant-api03-' + 'Zq7'.repeat(14), gh: 'gh' + 'p_' + 'Yx4'.repeat(12), env: 'Wv2Wv2Wv2Wv2', email: 'leak.me@example.org' };
const secretText = `use ${SECRET.key} and ${SECRET.gh}\nDB_PASSWORD=${SECRET.env}\nmail ${SECRET.email}`;
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'office-o2-'))); roots.push(root);
  const copy = (from: string, to: string) => { for (const n of fs.readdirSync(from)) { const a = path.join(from, n), b = path.join(to, n);
    if (fs.statSync(a).isDirectory()) { fs.mkdirSync(b, { recursive: true }); copy(a, b); } else fs.writeFileSync(b, fs.readFileSync(a, 'utf8').split('__ROOT__').join(root)); } };
  copy(FIX, root);
  fs.writeFileSync(path.join(root, 'outside/notes.txt'), 'OFFLIST-OUTSIDE-MARKER\n' + secretText);
  const cfg: Config = { home: path.join(root, 'home'), coordination: path.join(root, 'coordination'), promptKnowledge: path.join(root, 'pk'), roomData: path.join(root, 'room-data'),
    claudeProject: path.join(root, 'proj'), coordinatorSession: S, spool: path.join(root, 'spool') };
  return { root, cfg, D: path.join(root, 'coordination/2026-10-17/date') };
}
const spoolText = (cfg: Config) => fs.existsSync(cfg.spool!) ? fs.readdirSync(cfg.spool!).map(n => fs.readFileSync(path.join(cfg.spool!, n), 'utf8')).join('\n') : '';
const MARKERS = ['OFFLIST-OUTSIDE-MARKER', 'OFFLIST-BASH-MARKER', 'OFFLIST-WRITE-MARKER', 'OFFLIST-CODEX-MARKER', 'OFFLIST-CODEXWRITE-MARKER', ...Object.values(SECRET)];

test('hook records: parsing into events (tool calls, sub-agents, prompts), out-of-order and duplicate tolerant', () => {
  const { cfg, D } = fixture(), allow = new Allowlist(cfg), at = (s: number) => new Date(Date.UTC(2026, 9, 18, 9, 0, s)).toISOString();
  const h = (o: any, s: number) => hookRecord({ session_id: S, cwd: D, ...o }, allow, at(s));
  const recs = [
    h({ hook_event_name: 'UserPromptSubmit', prompt: 'please label' }, 0),
    h({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'tu1', tool_input: { description: 'Label T-3911f729', prompt: `Read ${D}/rubric-v1.md` } }, 1),
    h({ hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 'tu1', tool_input: {}, tool_response: { status: 'async_launched', agentId: 'a1234567890abcdef' } }, 2),
    h({ hook_event_name: 'PreToolUse', agent_id: 'a1234567890abcdef', tool_name: 'Read', tool_use_id: 'tu2', tool_input: { file_path: `${D}/rubric-v1.md` } }, 3),
    h({ hook_event_name: 'PostToolUse', agent_id: 'a1234567890abcdef', tool_name: 'Read', tool_use_id: 'tu2', tool_input: { file_path: `${D}/rubric-v1.md` }, tool_response: { file: { content: 'rubric text' } } }, 4),
    h({ hook_event_name: 'PreToolUse', agent_id: 'a1234567890abcdef', tool_name: 'Bash', tool_use_id: 'tu3', tool_input: { command: 'cat blind/T-3911f729.md | head -2', description: 'peek' } }, 5),
    h({ hook_event_name: 'PostToolUse', agent_id: 'a1234567890abcdef', tool_name: 'Bash', tool_use_id: 'tu3', tool_input: { command: 'cat blind/T-3911f729.md | head -2' }, tool_response: { stdout: 'Exit code 1', stderr: '' } }, 6),
    h({ hook_event_name: 'SubagentStop', agent_id: 'a1234567890abcdef' }, 7),
  ];
  append(cfg.spool!, 'hooks', [recs[0], recs[4], recs[3], ...recs.slice(1, 3), recs[5], recs[6], recs[6], recs[7]], recs[0].ts); // shuffled + one duplicate
  const sink = new Sink(), allowS = new Allowlist(cfg); parseSpool(fs.readdirSync(cfg.spool!).map(n => path.join(cfg.spool!, n))[0], sink, allowS, { primarySession: S });
  const E = sink.events.sort((a, b) => a.ts.localeCompare(b.ts)), sig = E.map(e => `${e.actor.id} ${e.verb} ${e.target?.kind === 'file' ? path.basename(e.target.path!) : e.target?.id}${e.outcome ? ' ' + e.outcome : ''}`);
  assert.deepEqual(sig, ['deniz message coordinator', 'coordinator spawn agent:a1234567890abcdef ok', 'agent:a1234567890abcdef read rubric-v1.md ok', 'agent:a1234567890abcdef read T-3911f729.md error', 'agent:a1234567890abcdef end coordinator done']);
  assert.ok(E.every(e => e.source.endsWith('.jsonl')));
  assert.equal(E.find(e => e.verb === 'read' && e.target?.path?.endsWith('T-3911f729.md'))!.provenance, 'derived');
  assert.match(sink.sources[0].note!, /^1 duplicates dropped/);
  // a tool call already in a transcript is not doubled
  const s2 = new Sink(); parseSpool(fs.readdirSync(cfg.spool!).map(n => path.join(cfg.spool!, n))[0], s2, allowS, { primarySession: S, known: new Set(['tu2|read|' + path.join(D, 'rubric-v1.md')]) });
  assert.equal(s2.events.filter(e => e.verb === 'read').length, 1);
});

test('spool privacy: allowlist, withholding and redaction run before anything is written', async () => {
  const { root, cfg, D } = fixture(), allow = new Allowlist(cfg), now = new Date().toISOString(), off = path.join(root, 'outside/notes.txt');
  const recs = [
    hookRecord({ hook_event_name: 'PostToolUse', session_id: S, cwd: D, tool_name: 'Read', tool_use_id: 'r', tool_input: { file_path: off }, tool_response: { file: { content: fs.readFileSync(off, 'utf8') } } }, allow, now),
    hookRecord({ hook_event_name: 'PostToolUse', session_id: S, cwd: D, tool_name: 'Bash', tool_use_id: 'b', tool_input: { command: `cat ${off} # ${SECRET.key}`, description: 'x ' + SECRET.gh }, tool_response: { stdout: 'OFFLIST-BASH-MARKER ' + secretText } }, allow, now),
    hookRecord({ hook_event_name: 'PreToolUse', session_id: S, cwd: D, tool_name: 'Write', tool_use_id: 'w', tool_input: { file_path: path.join(root, 'home/x.md'), content: 'OFFLIST-WRITE-MARKER' } }, allow, now),
    hookRecord({ hook_event_name: 'PreToolUse', session_id: S, cwd: D, tool_name: 'Bash', tool_use_id: 'e', tool_input: { command: `echo OFFLIST-WRITE-MARKER >> ${root}/home/off.txt` } }, allow, now),
    hookRecord({ hook_event_name: 'UserPromptSubmit', session_id: S, cwd: D, prompt: 'here ' + secretText }, allow, now),
    hookRecord({ hook_event_name: 'PreToolUse', session_id: S, cwd: D, tool_name: 'Agent', tool_use_id: 'ag', tool_input: { description: 'Label', prompt: 'token=' + 'Q'.repeat(30) + ' ' + SECRET.key } }, allow, now),
    codexRecord({ type: 'item.completed', item: { type: 'command_execution', command: `bash -lc 'for f in ${root}/outside/*; do cat "$f"; done'`, aggregated_output: 'OFFLIST-CODEX-MARKER ' + secretText, exit_code: 0 } }, 'run1', 1, allow, D, {}, now),
    codexRecord({ type: 'item.completed', item: { type: 'command_execution', command: `bash -lc 'printf OFFLIST-CODEXWRITE-MARKER > ${root}/home/y'`, aggregated_output: '', exit_code: 0 } }, 'run1', 2, allow, D, {}, now),
    codexRecord({ type: 'item.completed', item: { type: 'agent_message', text: 'verdict ' + secretText } }, 'run1', 3, allow, D, {}, now),
    codexRecord({ type: 'error', message: 'quota ' + SECRET.key }, 'run1', 4, allow, D, {}, now),
  ];
  append(cfg.spool!, 'hooks', recs.slice(0, 6), now); append(cfg.spool!, 'codex', recs.slice(6), now);
  // and through the real hook script process
  const hook = spawnSync(process.execPath, ['--no-warnings', path.join(OFFICE, 'capture/hook.ts')], { input: JSON.stringify({ hook_event_name: 'PostToolUse', session_id: S, cwd: D, tool_name: 'Bash', tool_use_id: 'p', tool_input: { command: 'cd ~/.codex && cat auth.json' }, tool_response: { stdout: 'OFFLIST-BASH-MARKER ' + SECRET.key } }),
    env: { ...process.env, OFFICE_HOME: cfg.home, OFFICE_COORDINATION: cfg.coordination, OFFICE_PROMPT_KNOWLEDGE: cfg.promptKnowledge, OFFICE_ROOM_DATA: cfg.roomData, OFFICE_CLAUDE_PROJECT: cfg.claudeProject, OFFICE_SPOOL: cfg.spool } });
  assert.equal(hook.status, 0); assert.equal(String(hook.stdout), '');
  const raw = spoolText(cfg);
  for (const m of MARKERS) assert.ok(!raw.includes(m), 'reached the spool: ' + m);
  assert.ok(raw.includes('output withheld (unverifiable)') && raw.includes('(content withheld)') && raw.includes('off-allowlist: path only') && raw.includes('[redacted:'));
  assert.ok(raw.includes(off), 'paths stay as metadata');
  // read side: the API redacts again and never serves the spool file whole
  const o = createOffice(cfg), srv = o.app.listen(0, '127.0.0.1'); await new Promise(r => srv.once('listening', r));
  try {
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, ev = (await (await fetch(base + '/api/events?op=*')).json()).events;
    let all = ''; for (const e of ev) all += await (await fetch(base + '/api/expand/event/' + e.id)).text();
    for (const f of fs.readdirSync(cfg.spool!)) { const r = await (await fetch(base + '/api/expand/file?path=' + encodeURIComponent(path.join(cfg.spool!, f)))).json(); assert.equal(r.content, undefined); assert.equal(r.allowed, false); }
    for (const m of MARKERS) assert.ok(!all.includes(m), 'served: ' + m);
  } finally { await new Promise(r => srv.close(r)); }
});

// ---- office-codex wrapper: the caller contract, against a stand-in codex ----------------------------------------
const FAKE = path.join(__dirname, 'bin/fake-codex.mjs');
function wrap(args: string[], env: Record<string, string>, input?: string | null, onSpawn?: (p: ReturnType<typeof spawn>) => void) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>(res => {
    const p = spawn(process.execPath, ['--no-warnings', path.join(OFFICE, 'capture/codex-wrapper.ts'), ...args], { env: { ...process.env, OFFICE_CODEX_BIN: FAKE, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; p.stdout.on('data', b => stdout += b); p.stderr.on('data', b => stderr += b);
    p.on('close', (code, signal) => res({ code, signal, stdout, stderr }));
    if (input != null) p.stdin.end(input); onSpawn?.(p);
  });
}
test('office-codex: exit status, stdout = final message, stderr, stdin and argv forwarding, schema, resume', async () => {
  const { cfg, root } = fixture(), rec = path.join(root, 'rec.json'), env = { OFFICE_HOME: cfg.home, OFFICE_COORDINATION: cfg.coordination, OFFICE_SPOOL: cfg.spool!, FAKE_RECORD: rec };
  const prompt = 'Read ONLY these files: a.md\n«unicode» “quotes” \'single\' $HOME `tick`\n';
  const ok = await wrap(['-C', cfg.coordination, '-s', 'read-only', '--output-schema', '/tmp/s.json', 'arg with spaces', '-'], { ...env, FAKE_FINAL: '{"verdict":1}\n', FAKE_STDERR: 'progress line\nwarning: x\n',
    FAKE_EVENTS: JSON.stringify([{ type: 'item.completed', item: { type: 'agent_message', text: 'hi' } }]) }, prompt);
  assert.equal(ok.code, 0); assert.equal(ok.stdout, '{"verdict":1}\n', 'stdout carries only the final message'); assert.equal(ok.stderr, 'progress line\nwarning: x\n', 'stderr untouched');
  const r = JSON.parse(fs.readFileSync(rec, 'utf8'));
  assert.equal(r.stdin, prompt, 'stdin forwarded byte for byte');
  assert.deepEqual(r.argv.slice(0, 2), ['exec', '--json']); assert.equal(r.argv[2], '-o');
  assert.deepEqual(r.argv.slice(4), ['-C', cfg.coordination, '-s', 'read-only', '--output-schema', '/tmp/s.json', 'arg with spaces', '-'], 'argv forwarded in order, schema included');
  assert.ok(!ok.stdout.includes('thread.started'), 'JSONL never reaches the caller');
  const fail = await wrap(['-'], { ...env, FAKE_EXIT: '1', FAKE_FINAL: '' }, 'x');
  assert.equal(fail.code, 1); assert.equal(fail.stdout, '');
  const quota = await wrap(['-'], { ...env, FAKE_EXIT: '1', FAKE_STDERR: 'ERROR: You’ve hit your usage limit.\n' }, 'x');
  assert.equal(quota.code, 1); assert.equal(quota.stderr, 'ERROR: You’ve hit your usage limit.\n');
  const odd = await wrap(['-'], { ...env, FAKE_EXIT: '42', FAKE_FINAL: 'partial' }, 'x'); assert.equal(odd.code, 42); assert.equal(odd.stdout, 'partial');
  // caller's own -o is honoured (and still echoed on stdout); --json given twice is not doubled
  const mine = path.join(root, 'mine.txt'), own = await wrap(['--json', '-o', mine, '-'], { ...env, FAKE_FINAL: 'mine' }, 'x');
  assert.equal(own.stdout, 'mine'); assert.equal(fs.readFileSync(mine, 'utf8'), 'mine');
  const r2 = JSON.parse(fs.readFileSync(rec, 'utf8')); assert.deepEqual(r2.argv, ['exec', '--json', '-o', mine, '-']);
  const res = await wrap(['resume', '01a11601-e4a6-7672-8c8a-fe17341a6700', '-'], { ...env, FAKE_FINAL: 'GO' }, 'recheck');
  assert.equal(res.stdout, 'GO'); assert.deepEqual(JSON.parse(fs.readFileSync(rec, 'utf8')).argv.filter((a: string) => !a.includes('office-codex-')), ['exec', 'resume', '--json', '-o', '01a11601-e4a6-7672-8c8a-fe17341a6700', '-']);
  // spool written: start, prompt, events, end
  const kinds = spoolText(cfg).split('\n').filter(Boolean).map(l => JSON.parse(l).kind); assert.ok(kinds.includes('start') && kinds.includes('prompt') && kinds.includes('end'));
});
test('office-codex: a spool failure never changes what the caller sees', async () => {
  const { root, cfg } = fixture(), blocker = path.join(root, 'not-a-dir'); fs.writeFileSync(blocker, 'x');
  const r = await wrap(['-'], { OFFICE_HOME: cfg.home, OFFICE_SPOOL: path.join(blocker, 'spool'), FAKE_FINAL: 'final', FAKE_EXIT: '3', FAKE_STDERR: 'e\n' }, 'p');
  assert.equal(r.code, 3); assert.equal(r.stdout, 'final'); assert.equal(r.stderr, 'e\n');
});
test('office-codex: signals are forwarded, and a signal death is passed through', async () => {
  const { root, cfg } = fixture(), rec = path.join(root, 'rec.json'), env = { OFFICE_HOME: cfg.home, OFFICE_SPOOL: cfg.spool!, FAKE_RECORD: rec, FAKE_SLEEP: '1' };
  const term = await wrap(['-'], env, 'p', p => setTimeout(() => p.kill('SIGTERM'), 600));
  assert.equal(term.signal, 'SIGKILL', 'the stand-in reacts to SIGTERM by dying with SIGKILL; the wrapper dies the same way');
  assert.equal(JSON.parse(fs.readFileSync(rec, 'utf8')).gotSignal, 'SIGTERM', 'SIGTERM reached codex');
  const int = await wrap(['-'], env, 'p', p => setTimeout(() => p.kill('SIGINT'), 600));
  assert.equal(int.code, 130); assert.equal(JSON.parse(fs.readFileSync(rec, 'utf8')).gotSignal, 'SIGINT');
  const self = await wrap(['-'], { OFFICE_HOME: cfg.home, OFFICE_SPOOL: cfg.spool!, FAKE_SIGNAL: 'SIGTERM' }, 'p');
  assert.equal(self.signal, 'SIGTERM');
  const missing = await wrap(['-'], { OFFICE_HOME: cfg.home, OFFICE_SPOOL: cfg.spool!, OFFICE_CODEX_BIN: path.join(root, 'no-such-codex') }, 'p');
  assert.equal(missing.code, 127); assert.match(missing.stderr, /cannot run/);
});

// ---- live tier, SSE, replay equivalence ---------------------------------------------------------------------------
async function sse(base: string) {
  const ctl = new AbortController(), r = await fetch(base + '/api/live', { signal: ctl.signal }), rd = r.body!.getReader(), dec = new TextDecoder(), msgs: any[] = []; let buf = '';
  void (async () => { try { for (;;) { const { done, value } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i;
    while ((i = buf.indexOf('\n\n')) >= 0) { const b = buf.slice(0, i); buf = buf.slice(i + 2); const ev = b.match(/^event: (\w+)/m)?.[1], d = b.match(/^data: (.*)$/m)?.[1]; if (ev && d) msgs.push({ ev, data: JSON.parse(d) }); } } } catch {} })();
  return { msgs, close: () => ctl.abort() };
}
test('live: tailing + SSE upserts fold into exactly the replay event list; same floor state', async () => {
  const { cfg, D } = fixture(), M: any = await import(path.join(OFFICE, 'web/model.mjs'));
  const recs = [...simulate({ cfg, dir: D, ids: ['T-3911f729', 'T-00000000'], rubric: 'rubric-v1.md', t0: Date.UTC(2026, 9, 18, 10), stepMs: 500, primarySession: S, operation: '2026-10-17/date/labeling', tail: '\n' + SECRET.key })];
  const o = createOffice(cfg, {}), srv = o.app.listen(0, '127.0.0.1'); await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, s = await sse(base);
  try {
    let client: any[] = (await (await fetch(base + '/api/events?op=*')).json()).events;
    // batches split a spawn from its result and a Codex start from its prompt
    for (const part of [recs.slice(0, 1), recs.slice(1, 2), recs.slice(2, 12), recs.slice(12, 13), recs.slice(13, 20), recs.slice(20)]) { writeAll(cfg.spool!, part); o.live.tick(); await new Promise(r => setTimeout(r, 60)); }
    const ups = s.msgs.filter(m => m.ev === 'events'); assert.ok(ups.length >= 5, 'one push per batch');
    assert.ok(ups.some(m => m.data.removes.length), 'a superseded spawn (target not yet known) is removed live');
    for (const m of ups) { const rm = new Set(m.data.removes), by = new Map(client.filter(e => !rm.has(e.id)).map(e => [e.id, e])); for (const e of m.data.upserts) by.set(e.id, e); client = [...by.values()]; }
    const sort = (l: any[]) => [...l].sort((a, b) => a.ts.localeCompare(b.ts) || a.id.localeCompare(b.id)), strip = (l: any[]) => sort(l).map(({ seq, ...e }) => e);
    const replay = (await (await fetch(base + '/api/events?op=*')).json()).events;
    assert.deepEqual(strip(client), strip(replay), 'live-assembled events equal the replay list');
    const lab = (l: any[]) => sort(l).filter(e => e.operation?.startsWith('2026-10-17/date/labeling')), actors = (await (await fetch(base + '/api/summary')).json()).actors;
    const L = lab(client), R = lab(replay), tl = M.timeline(R), ser = (x: any) => JSON.stringify({ a: [...x.actors].sort(), e: x.edges, m: x.marks });
    for (const f of [0.1, 0.4, 0.7, 1]) { const t = tl.toReal(tl.duration * f); assert.equal(ser(M.stateAt(L, actors, t)), ser(M.stateAt(R, actors, t))); }
    // the run shows each labeler by name opening its three files and returning its verdict
    const names = new Set(R.filter((e: any) => e.verb === 'end').map((e: any) => `${e.actor.name}: ${e.outcome}`));
    for (const n of ['labeler · Claude · date labeling · T-3911f729: done', 'labeler · Codex · date labeling · T-3911f729: verdict']) assert.ok(names.has(n), n + ' in ' + [...names]);
    const reads = R.filter((e: any) => e.verb === 'read' && e.source.includes('/spool/') && e.actor.name?.endsWith('T-3911f729')).map((e: any) => `${e.actor.name.split(' · ')[1]} ${path.basename(e.target.path)}`).sort();
    assert.deepEqual(reads, ['Claude T-3911f729.md', 'Claude labeler-prompt.md', 'Claude rubric-v1.md', 'Codex T-3911f729.md', 'Codex labeler-prompt.md', 'Codex rubric-v1.md']);
    assert.ok(!JSON.stringify(s.msgs).includes(SECRET.key) && !spoolText(cfg).includes(SECRET.key));
  } finally { s.close(); await new Promise(r => srv.close(r)); }
});

test('focus hides inactive nodes; follow narrows to an agent and its children', async () => {
  const M: any = await import(path.join(OFFICE, 'web/model.mjs')), T0 = Date.UTC(2026, 9, 18, 12), at = (m: number) => new Date(T0 + m * 60e3).toISOString();
  const ev = (seq: number, ts: string, actor: string, verb: string, target: any) => ({ id: 'e' + seq, seq, ts, actor: { id: actor, kind: 'labeler', label: actor }, verb, target, provenance: 'captured' });
  const actors = [{ id: 'coordinator', kind: 'coordinator', label: 'C', permanent: true }, { id: 'archive', kind: 'artifact', label: 'Archive', permanent: true }, { id: 'critic', kind: 'critic', label: 'Critic', permanent: true },
    { id: 'old', kind: 'labeler', label: 'old', parent: 'coordinator' }, { id: 'a', kind: 'labeler', label: 'a', parent: 'coordinator' }, { id: 'kid', kind: 'labeler', label: 'kid', parent: 'a' }, { id: 'b', kind: 'labeler', label: 'b', parent: 'coordinator' }];
  const events = [ev(1, at(0), 'coordinator', 'spawn', { kind: 'actor', id: 'old' }), ev(2, at(1), 'old', 'end', { kind: 'actor', id: 'coordinator' }),
    ev(3, at(30), 'coordinator', 'spawn', { kind: 'actor', id: 'a' }), ev(4, at(31), 'a', 'read', { kind: 'file', path: '/c/x.md', group: 'archive' }), ev(5, at(32), 'a', 'spawn', { kind: 'actor', id: 'kid' }),
    ev(6, at(33), 'coordinator', 'spawn', { kind: 'actor', id: 'b' })];
  const v = M.visibleAt(events, actors, T0 + 34 * 60e3);
  assert.deepEqual([...v.actors].sort(), ['a', 'b', 'kid']); assert.ok(!v.actors.has('old'), 'ended outside the window: hidden'); assert.ok(v.hubs.has('coordinator') && v.hubs.has('archive') && !v.hubs.has('critic'));
  const f = M.visibleAt(events, actors, T0 + 34 * 60e3, { follow: 'a' }); assert.deepEqual([...f.actors].sort(), ['a', 'kid']);
  assert.deepEqual(M.descendants('a', actors), ['kid']);
  assert.equal(M.visibleAt(events, actors, T0 + 2 * 60e3).actors.has('old'), true);
});

test('narration: deterministic plain sentences from metadata', async () => {
  const M: any = await import(path.join(OFFICE, 'web/model.mjs')), names: Record<string, string> = { 'agent:x': 'labeler · Claude · date labeling · T-1', coordinator: 'Coordinator (Claude)', 'critic:y': 'critic · Codex · office release', critic: 'Critic (Codex)' };
  const n = (id: string) => names[id] || id, E = (o: any) => ({ provenance: 'captured', actor: { id: 'agent:x', kind: 'labeler' }, ...o });
  const cases: [any, string][] = [
    [E({ verb: 'spawn', actor: { id: 'coordinator', kind: 'coordinator' }, target: { kind: 'actor', id: 'agent:x' } }), 'Coordinator (Claude) started labeler · Claude · date labeling · T-1.'],
    [E({ verb: 'read', target: { kind: 'file', path: '/c/2026-10-17/date/rubric-v1.md' } }), 'labeler · Claude · date labeling · T-1 opened the rubric.'],
    [E({ verb: 'read', target: { kind: 'file', path: '/c/d/blind/T-1.md' }, provenance: 'derived' }), 'labeler · Claude · date labeling · T-1 opened transcript T-1 (derived).'],
    [E({ verb: 'write', target: { kind: 'file', path: '/c/d/labels/claude/T-1.json' } }), 'labeler · Claude · date labeling · T-1 wrote its verdict for T-1.'],
    [E({ verb: 'end', outcome: 'verdict', target: { kind: 'actor', id: 'coordinator' } }), 'labeler · Claude · date labeling · T-1 returned its verdict.'],
    [E({ verb: 'end', actor: { id: 'critic:y', kind: 'critic' }, outcome: 'no-go', findings: 3, operation: 'office-o1' }), 'The critic ruled NO-GO on Office O1 (3 findings).'],
    [E({ verb: 'deviation', actor: { id: 'coordinator', kind: 'coordinator' }, label: 'handoff with no events.jsonl entry' }), 'Coverage gap: handoff with no events.jsonl entry.'],
    [E({ verb: 'message', actor: { id: 'deniz', kind: 'human' }, target: { kind: 'actor', id: 'coordinator' } }), 'Deniz wrote to Coordinator (Claude).'],
  ];
  for (const [e, want] of cases) { assert.equal(M.narrate(e, n, (x: string) => x === 'office-o1' ? 'Office O1' : x), want); assert.equal(M.narrate(e, n, (x: string) => x === 'office-o1' ? 'Office O1' : x), want); }
});

test('legibility: agent names from spawn context, operation titles', () => {
  const { cfg } = fixture(), c = collect(cfg);
  assert.equal(c.actors.get('agent:ad5030270006e2618')!.name, 'labeler · Claude · date labeling · T-3911f729');
  assert.equal(c.actors.get('codex:2026-10-17/date/labels/codex/T-3911f729')!.name, 'labeler · Codex · date labeling · T-3911f729');
  assert.equal(c.actors.get('critic:critic-2026-10-17-date-baseline')!.name, 'critic · Codex · date baseline');
  const op = c.operations.find(o => o.id === '2026-10-17/date/labeling')!; assert.equal(op.title, 'Date · labeling · 17 Oct');
  assert.equal(c.operations.find(o => o.id === '2026-10-17/date/run-baseline')!.title, 'Date · baseline run · 17 Oct');
  assert.equal(c.operations.find(o => o.id === '2026-10-17/date')!.packet, 'Date room baseline: results');
});
