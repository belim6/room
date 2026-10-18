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
  const hook = spawnSync(process.execPath, ['--no-warnings', path.join(OFFICE, 'capture/hook.mjs')], { input: JSON.stringify({ hook_event_name: 'PostToolUse', session_id: S, cwd: D, tool_name: 'Bash', tool_use_id: 'p', tool_input: { command: 'cd ~/.codex && cat auth.json' }, tool_response: { stdout: 'OFFLIST-BASH-MARKER ' + SECRET.key } }),
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

// ---- O2 review fixes ------------------------------------------------------------------------------------------------
import { codexCwd, forwardSignal, findPreCwd } from '../capture/sanitize.ts';
import { readSpoolTail } from '../collect/spool';
import { verifyCommand } from '../collect/shell';

test('review 1: every form of the Codex cwd flag; an undeterminable cwd withholds all command output of the run', async () => {
  assert.deepEqual(codexCwd(['-C', '/a', '-'], '/x'), { cwd: '/a' }); assert.deepEqual(codexCwd(['-C/a'], '/x'), { cwd: '/a' });
  assert.deepEqual(codexCwd(['--cd', 'rel'], '/x'), { cwd: '/x/rel' }); assert.deepEqual(codexCwd(['--cd=/a'], '/x'), { cwd: '/a' });
  assert.deepEqual(codexCwd(['-s', 'read-only', '-'], '/x'), { cwd: '/x' }); assert.deepEqual(codexCwd(['-C', '/a', '--cd=/a/'], '/x'), { cwd: '/a' });
  for (const a of [['-C', '/a', '--cd=/b'], ['-C'], ['--cd'], ['-sC', '/a']]) assert.equal(codexCwd(a, '/x').cwd, null, a.join(' '));
  assert.deepEqual(codexCwd(['-m', '-C', '-'], '/x'), { cwd: '/x' }, 'a value of another flag is not a cwd flag');
  const { root, cfg, D } = fixture(), env = { OFFICE_HOME: cfg.home, OFFICE_COORDINATION: cfg.coordination, OFFICE_CLAUDE_PROJECT: cfg.claudeProject, OFFICE_ROOM_DATA: cfg.roomData, OFFICE_SPOOL: cfg.spool! };
  const ev = (out: string) => JSON.stringify([{ type: 'item.completed', item: { type: 'command_execution', command: "bash -lc 'cat labeler-prompt.md'", aggregated_output: out, exit_code: 0 } }]);
  const outputs = () => spoolText(cfg).split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.item?.type === 'command_execution').map(r => r.item.sections.find((x: any) => x.title === 'output'));
  for (const args of [['-C', D, '--cd=' + path.join(root, 'outside'), '-'], ['--cd', path.join(root, 'outside'), '-'], ['-C' + path.join(root, 'outside'), '-']]) {
    fs.rmSync(cfg.spool!, { recursive: true, force: true });
    await wrap(args, { ...env, FAKE_EVENTS: ev('OFFLIST-CWD-MARKER') }, 'p');
    assert.ok(!spoolText(cfg).includes('OFFLIST-CWD-MARKER'), args.join(' ')); assert.equal(outputs()[0].allowed, false);
  }
  fs.rmSync(cfg.spool!, { recursive: true, force: true });
  await wrap(['-C' + D, '-'], { ...env, FAKE_EVENTS: ev('VISIBLE-OUTPUT') }, 'p'); assert.equal(outputs()[0].text, 'VISIBLE-OUTPUT', '-CDIR inside the allowlist: shown');
});

class TestES { // EventSource stand-in over fetch, with drop() = network loss followed by the browser's automatic reconnect
  l: Record<string, ((m: any) => void)[]> = {}; ctl?: AbortController; closed = false;
  constructor(public url: string) { void this.connect(); }
  addEventListener(t: string, f: (m: any) => void) { (this.l[t] ||= []).push(f); }
  async connect() { this.ctl = new AbortController(); try { const r = await fetch(this.url, { signal: this.ctl.signal }), rd = r.body!.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) { const { done, value } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i;
      while ((i = buf.indexOf('\n\n')) >= 0) { const b = buf.slice(0, i); buf = buf.slice(i + 2); const ev = b.match(/^event: (\w+)/m)?.[1], data = b.match(/^data: (.*)$/m)?.[1]; if (ev && data) for (const f of this.l[ev] || []) f({ data }); } } } catch {} }
  drop() { this.ctl?.abort(); setTimeout(() => { if (!this.closed) void this.connect(); }, 50); }
  close() { this.closed = true; this.ctl?.abort(); }
}
test('review 2: live catch-up: events that arrive while Live is off, or while disconnected, show after reconnecting', async () => {
  const { cfg, D } = fixture(), { liveClient } = await import(path.join(OFFICE, 'web/liveclient.mjs'));
  const recs = [...simulate({ cfg, dir: D, ids: ['T-3911f729', 'T-00000000'], rubric: 'rubric-v1.md', t0: Date.UTC(2026, 9, 18, 11), stepMs: 500, primarySession: S, operation: '2026-10-17/date/labeling' })];
  const o = createOffice(cfg, {}), srv = o.app.listen(0, '127.0.0.1'); await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, get = async (u: string) => (await fetch(base + u)).json(), wait = (ms: number) => new Promise(r => setTimeout(r, ms));
  let client = new Map<string, any>(), es: TestES | null = null, resets = 0;
  const lc = liveClient({ url: base + '/api/live', ES: class extends TestES { constructor(u: string) { super(u); es = this; } } as any,
    refetch: async () => (await get('/api/events?op=*')).events, onReset: (ev: any[]) => { resets++; client = new Map(ev.map(e => [e.id, e])); },
    onDelta: (d: any) => { for (const id of d.removes) client.delete(id); for (const e of d.upserts) client.set(e.id, e); } });
  const ids = async () => (await get('/api/events?op=*')).events.map((e: any) => e.id).sort(), mine = () => [...client.keys()].sort();
  const push = async (part: any[]) => { writeAll(cfg.spool!, part); o.live.tick(); await wait(80); };
  try {
    lc.start(); await wait(150); assert.equal(resets, 1);
    await push(recs.slice(0, 8)); assert.deepEqual(mine(), await ids(), 'deltas while connected');
    lc.stop(); await push(recs.slice(8, 16)); assert.notDeepEqual(mine(), await ids(), 'Live off: the client missed these');
    lc.start(); await wait(150); assert.equal(resets, 2); assert.deepEqual(mine(), await ids(), 'switching Live back on catches up');
    es!.drop(); await wait(10); await push(recs.slice(16)); await wait(250);
    assert.equal(resets, 3, 'the reconnect hello triggered a catch-up'); assert.deepEqual(mine(), await ids(), 'events from the disconnected gap are shown');
  } finally { lc.stop(); await new Promise(r => srv.close(r)); }
});

test('review 3: sub-agent transcript progress triggers the transcript fallback', async () => {
  const { cfg } = fixture(), o = createOffice(cfg, { fullMs: 0 }), sub = path.join(cfg.claudeProject, S, 'subagents/agent-ad5030270006e2618.jsonl');
  const before = o.live.sig(), n0 = o.data.events.length, rec = JSON.parse(fs.readFileSync(sub, 'utf8').split('\n').filter(Boolean).find(l => l.includes('"tool_use"') && l.includes('"Read"'))!);
  rec.uuid = 'f9-1'; rec.timestamp = '2026-10-17T17:42:20.500Z'; rec.message.id = 'msg_late'; rec.message.content[0].id = 'toolu_late';
  fs.appendFileSync(sub, JSON.stringify(rec) + '\n');
  assert.notEqual(o.live.sig(), before); o.live.tick();
  assert.equal(o.live.fulls, 1); assert.ok(o.data.events.length > n0); assert.ok(o.data.events.some(e => e.detailRef.key === 'toolu_late'));
});

test('review 4: PostToolUse output is checked against the PreToolUse cwd', async () => {
  const { root, cfg, D } = fixture(), allow = new Allowlist(cfg), out = (r: any) => r.sections.find((x: any) => x.title === 'output');
  const post = (cwd: string) => ({ hook_event_name: 'PostToolUse', session_id: S, cwd, tool_name: 'Bash', tool_use_id: 'x', tool_input: { command: 'cat labeler-prompt.md' }, tool_response: { stdout: 'PROMPT-TEXT' } });
  assert.equal(out(hookRecord(post(D), allow)).allowed, false, 'no Pre record: withheld');
  assert.equal(out(hookRecord(post(D), allow, undefined, { preCwd: D })).text, 'PROMPT-TEXT', 'same allowlisted cwd: shown');
  assert.equal(out(hookRecord(post(path.join(root, 'outside')), allow, undefined, { preCwd: D })).allowed, false, 'cwd changed to an off-allowlist dir: withheld');
  assert.equal(out(hookRecord(post(D), allow, undefined, { preCwd: path.join(root, 'outside') })).allowed, false, 'ran in an off-allowlist dir: withheld');
  // through the hook process: the Post finds its Pre in the spool
  const env = { ...process.env, OFFICE_HOME: cfg.home, OFFICE_COORDINATION: cfg.coordination, OFFICE_CLAUDE_PROJECT: cfg.claudeProject, OFFICE_ROOM_DATA: cfg.roomData, OFFICE_SPOOL: cfg.spool };
  const run = (h: any) => spawnSync(process.execPath, ['--no-warnings', path.join(OFFICE, 'capture/hook.mjs')], { input: JSON.stringify(h), env });
  run({ ...post(D), hook_event_name: 'PreToolUse', tool_use_id: 'y', tool_response: undefined }); assert.equal(findPreCwd(cfg.spool!, 'y'), D);
  run({ ...post(D), tool_use_id: 'y' });
  const recs = spoolText(cfg).split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.toolUseId === 'y' && r.event === 'PostToolUse');
  assert.equal(out(recs[0]).text, 'PROMPT-TEXT');
});

test('review 5: spool tails are read by byte offset; the transcript fallback backs off while hooks deliver', () => {
  const { cfg } = fixture(), f = path.join(cfg.spool!, 'hooks-2026-10-18.jsonl'), line = (id: string) => JSON.stringify({ v: 1, src: 'hook', ts: new Date().toISOString(), id, event: 'Stop', session: S }) + '\n';
  fs.mkdirSync(cfg.spool!, { recursive: true }); fs.writeFileSync(f, line('a') + line('b') + '{"v":1,"partial');
  const st = readSpoolTail(f); assert.equal(st.recs.length, 2); const off = st.offset; assert.equal(off, Buffer.byteLength(line('a') + line('b')));
  // old bytes are not re-read: overwrite them in place; only the new tail is parsed
  const fd = fs.openSync(f, 'r+'); fs.writeSync(fd, Buffer.alloc(10, 0x78), 0, 10, 0); fs.closeSync(fd);
  fs.appendFileSync(f, '"}\n' + line('c'));
  readSpoolTail(f, st); assert.deepEqual(st.recs.map(x => x.r.id), ['a', 'b', 'c']); assert.equal(st.unparsed, 1, 'the joined partial line is one bad record');
  const o = createOffice(cfg, { fullMs: 0, fullMsWithHooks: 60_000 });
  fs.appendFileSync(path.join(cfg.claudeProject, S + '.jsonl'), '\n'); o.live.tick(); assert.equal(o.live.fulls, 0, 'hooks active: transcripts wait for the longer interval');
  o.live.tick(Date.now() + 61_000); assert.equal(o.live.fulls, 1);
});

test('review 6: a hook load failure is still counted; Ctrl-C is not forwarded twice', () => {
  const { root } = fixture(), dir = path.join(root, 'hookcopy'), spool = path.join(root, 'sp'); fs.mkdirSync(dir);
  fs.copyFileSync(path.join(OFFICE, 'capture/hook.mjs'), path.join(dir, 'hook.mjs')); // no hook-main.ts next to it
  const r = spawnSync(process.execPath, ['--no-warnings', path.join(dir, 'hook.mjs')], { input: '{}', env: { ...process.env, OFFICE_SPOOL: spool } });
  assert.equal(r.status, 0); assert.equal(String(r.stdout), ''); assert.match(fs.readFileSync(path.join(spool, 'errors.count'), 'utf8'), /\thook-load\t/);
  assert.equal(forwardSignal('SIGINT', true), false); assert.equal(forwardSignal('SIGQUIT', true), false);
  assert.equal(forwardSignal('SIGINT', false), true); assert.equal(forwardSignal('SIGTERM', true), true);
});

// ---- Deniz's decisions, 2026-10-18 ------------------------------------------------------------------------------------
test('decision A: agent prose stays out of summaries and default Expand; the third-click route returns it, redacted', async () => {
  const { cfg, D } = fixture(), allow = new Allowlist(cfg), now = '2026-10-18T12:00:00.000Z', meta = { role: 'labeler', label: 'Codex labeler T-x', operation: '2026-10-17/date/labeling', cwd: D };
  append(cfg.spool!, 'codex', [
    { v: 1, src: 'codex', ts: now, run: 'r-prose', seq: 0, kind: 'start', ...meta, id: 'r-prose:start', args: ['-'] },
    codexRecord({ type: 'item.completed', item: { type: 'reasoning', text: 'PROSE-REASON ' + SECRET.key } }, 'r-prose', 1, allow, D, meta, now),
    codexRecord({ type: 'item.completed', item: { type: 'agent_message', text: 'PROSE-AGENTMSG' } }, 'r-prose', 2, allow, D, meta, now),
    codexRecord({ type: 'error', message: 'PROSE-ERR' }, 'r-prose', 3, allow, D, meta, now),
    { v: 1, src: 'codex', ts: now, run: 'r-prose', seq: 4, kind: 'end', id: 'r-prose:end', exit: { code: 0, signal: null }, ...meta, sections: [{ title: 'final message', prose: true, text: 'PROSE-FINAL' }] },
  ], now);
  append(cfg.spool!, 'hooks', [hookRecord({ hook_event_name: 'SubagentStop', session_id: S, cwd: D, agent_id: 'a99999999999999999', last_assistant_message: 'PROSE-LAST' }, allow, now)], now);
  const sess = path.join(cfg.claudeProject, S + '.jsonl'), rec = (o: any) => JSON.stringify({ parentUuid: null, isSidechain: false, cwd: D, sessionId: S, ...o }) + '\n';
  fs.appendFileSync(sess, rec({ type: 'assistant', uuid: 'p1', timestamp: '2026-10-17T18:10:00.000Z', message: { id: 'msg_p', role: 'assistant', content: [{ type: 'thinking', thinking: 'PROSE-THINK', signature: 'x' }, { type: 'text', text: 'PROSE-TEXT' },
    { type: 'tool_use', id: 'toolu_p', name: 'Read', input: { file_path: path.join(D, 'rubric-v1.md') } }] } }));
  fs.appendFileSync(sess, rec({ type: 'user', uuid: 'p2', timestamp: '2026-10-17T18:10:01.000Z', message: { role: 'user', content: [{ tool_use_id: 'toolu_p', type: 'tool_result', content: 'rubric' }] } }));
  fs.appendFileSync(sess, rec({ type: 'user', uuid: 'p3', timestamp: '2026-10-17T18:10:02.000Z', message: { role: 'user', content: '<task-notification>\n<task-id>ad5030270006e2618</task-id>\n<status>completed</status>\n<result>PROSE-NOTIFY</result>\n</task-notification>' } }));
  const o = createOffice(cfg), srv = o.app.listen(0, '127.0.0.1'); await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, text = async (u: string) => (await fetch(base + u)).text(), MK = ['PROSE-REASON', 'PROSE-AGENTMSG', 'PROSE-ERR', 'PROSE-FINAL', 'PROSE-LAST', 'PROSE-THINK', 'PROSE-TEXT', 'PROSE-NOTIFY'];
  try {
    const evs = JSON.parse(await text('/api/events?op=*')).events; let def = await text('/api/summary') + JSON.stringify(evs), third = '';
    for (const e of evs) { def += await text('/api/expand/event/' + e.id); third += await text('/api/expand/event/' + e.id + '/prose'); }
    for (const m of MK) { assert.ok(!def.includes(m), 'default tier shows ' + m); assert.ok(third.includes(m), 'third click lacks ' + m); }
    assert.ok(def.includes('unverified agent text'), 'default Expand marks where prose was held back');
    assert.ok(!third.includes(SECRET.key) && third.includes('[redacted:'), 'prose is still redacted');
  } finally { await new Promise(r => srv.close(r)); }
});

test('decision B: the repo is on the allowlist, with its exclusions path-only', async () => {
  const { root, cfg } = fixture(), R = path.join(root, 'repo'), w = (p: string, t: string) => { fs.mkdirSync(path.dirname(path.join(R, p)), { recursive: true }); fs.writeFileSync(path.join(R, p), t); };
  w('src/workbench/x.ts', 'REPO-SOURCE'); w('.env', 'ENV-SECRET'); w('web/.env.local', 'ENV-LOCAL'); w('saves/s.md', 'SAVES'); w('saved/s.md', 'SAVED'); w('oldsaves/o.md', 'OLD'); w('prompt-archive/p.md', 'ARCH');
  w('_dead/d.ts', 'DEAD'); w('node_modules/m/i.js', 'NM'); w('.git/config', 'GITCONF'); w('office-spool/hooks-2026-10-18.jsonl', '{"v":1}'); w('.room-data/trash/t.json', 'TRASH'); w('.room-data/revisions/r.json', '{"REV":1}');
  const c2: Config = { ...cfg, repos: [R], spool: path.join(R, 'office-spool'), roomData: path.join(R, '.room-data') }, al = new Allowlist(c2);
  assert.equal(al.read(path.join(R, 'src/workbench/x.ts')).content, 'REPO-SOURCE');
  assert.equal(al.read(path.join(R, '.room-data/revisions/r.json')).content, '{"REV":1}');
  for (const p of ['.env', 'web/.env.local', 'saves/s.md', 'saved/s.md', 'oldsaves/o.md', 'prompt-archive/p.md', '_dead/d.ts', 'node_modules/m/i.js', '.git/config', 'office-spool/hooks-2026-10-18.jsonl', '.room-data/trash/t.json']) {
    const r = al.read(path.join(R, p)); assert.equal(r.allowed, false, p); assert.equal(r.content, undefined, p);
  }
  fs.symlinkSync(path.join(root, 'outside/notes.txt'), path.join(R, 'src/link.md')); assert.equal(al.read(path.join(R, 'src/link.md')).allowed, false, 'symlink out of the repo');
  // shell output inside the repo is now verifiable; touching an excluded path is not
  const v = (cmd: string) => verifyCommand(cmd, R, c2.home, p => al.allows(p), p => al.allowsDir(p)).ok;
  assert.equal(v('cat src/workbench/x.ts | head -3'), true); assert.equal(v('cat .env'), false); assert.equal(v('cat saves/s.md'), false); assert.equal(v('cd .git && cat config'), false);
  const o = createOffice(c2), srv = o.app.listen(0, '127.0.0.1'); await new Promise(r => srv.once('listening', r));
  try { const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, get = async (p: string) => (await fetch(base + '/api/expand/file?path=' + encodeURIComponent(path.join(R, p)))).json();
    assert.equal((await get('src/workbench/x.ts')).content, 'REPO-SOURCE');
    for (const p of ['.env', 'saves/s.md', '.git/config', 'office-spool/hooks-2026-10-18.jsonl']) { const r = await get(p); assert.equal(r.content, undefined, p); assert.equal(r.allowed, false, p); }
  } finally { await new Promise(r => srv.close(r)); }
});

// ---- recheck of 2a81fa0 -----------------------------------------------------------------------------------------------
test('recheck 1: case variants cannot reach excluded paths (case-insensitive volumes), including through open-then-verify', async () => {
  const { root, cfg } = fixture(), R = path.join(root, 'repo'), w = (p: string, t: string) => { fs.mkdirSync(path.dirname(path.join(R, p)), { recursive: true }); fs.writeFileSync(path.join(R, p), t); };
  w('src/x.ts', 'REPO-SOURCE'); w('.env', 'ENV-SECRET'); w('.git/config', 'GITCONF'); w('office-spool/hooks-2026-10-18.jsonl', '{"v":1,"RAW":1}'); w('.room-data/trash/t.json', 'TRASH'); w('node_modules/m/i.js', 'NM'); w('saves/s.md', 'SAVES');
  if (!fs.existsSync(path.join(R, '.ENV'))) return; // case-sensitive volume: the variants simply don't exist
  const c2: Config = { ...cfg, repos: [R], spool: path.join(R, 'office-spool'), roomData: path.join(R, '.room-data') }, al = new Allowlist(c2);
  assert.equal(al.canonical(path.join(R, '.GIT/CONFIG')), path.join(R, '.git/config'), 'canonical path carries the on-disk case');
  const variants = ['.ENV', '.Env', '.Git/config', '.GIT/CONFIG', 'OFFICE-SPOOL/hooks-2026-10-18.jsonl', 'Office-Spool/hooks-2026-10-18.jsonl', '.Room-Data/Trash/t.json', '.ROOM-DATA/trash/t.json', 'NODE_MODULES/m/i.js', 'Node_Modules/m/i.js', 'SAVES/s.md', 'Saves/s.md'];
  for (const p of variants) { const r = al.read(path.join(R, p)); assert.equal(r.allowed, false, p); assert.equal(r.content, undefined, p); assert.equal(al.allows(path.join(R, p)), false, p); }
  assert.equal(al.read(path.join(R, 'SRC/X.TS')).content, 'REPO-SOURCE', 'an allowed file in another case is still the allowed file');
  assert.equal(verifyCommand('cat .ENV', R, c2.home, p => al.allows(p), p => al.allowsDir(p)).ok, false);
  assert.equal(verifyCommand('cd .GIT && cat config', R, c2.home, p => al.allows(p), p => al.allowsDir(p)).ok, false);
  // through the server's file route as well, and with a symlink swapped in between check and open
  const o = createOffice(c2), srv = o.app.listen(0, '127.0.0.1'); await new Promise(r => srv.once('listening', r));
  try { const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    for (const p of variants) { const r = await (await fetch(base + '/api/expand/file?path=' + encodeURIComponent(path.join(R, p)))).json(); assert.equal(r.content, undefined, p); }
  } finally { await new Promise(r => srv.close(r)); }
  const f = path.join(R, 'src/x.ts'); al.beforeOpen = (p) => { if (p.toLowerCase() === f.toLowerCase()) { fs.renameSync(f, f + '.moved'); fs.symlinkSync(path.join(R, '.env'), f); } };
  const sw = al.read(path.join(R, 'SRC/x.ts')); assert.equal(sw.content, undefined); assert.equal(sw.allowed, false);
});

test('recheck 2: prose is decided on read; spool records without a stored prose flag stay behind the third click', async () => {
  const { cfg, D } = fixture(), now = '2026-10-18T12:30:00.000Z', meta = { role: 'labeler', label: 'old run', operation: '2026-10-17/date/labeling', cwd: D };
  append(cfg.spool!, 'codex', [ // as written before the flag existed: no `prose` anywhere
    { v: 1, src: 'codex', ts: now, run: 'r-old', seq: 0, kind: 'start', ...meta, id: 'r-old:start', args: ['-'] },
    { v: 1, src: 'codex', ts: now, run: 'r-old', seq: 1, kind: 'event', type: 'item.completed', item: { type: 'agent_message', sections: [{ title: 'message', text: 'OLD-PROSE-MSG' }] }, id: 'r-old:1' },
    { v: 1, src: 'codex', ts: now, run: 'r-old', seq: 2, kind: 'event', type: 'item.completed', item: { type: 'reasoning', sections: [{ title: 'reasoning', text: 'OLD-PROSE-REASON' }] }, id: 'r-old:2' },
    { v: 1, src: 'codex', ts: now, run: 'r-old', seq: 3, kind: 'end', exit: { code: 0, signal: null }, ...meta, sections: [{ title: 'final message', text: 'OLD-PROSE-FINAL' }], id: 'r-old:end' },
  ], now);
  append(cfg.spool!, 'hooks', [{ v: 1, src: 'hook', ts: now, event: 'SubagentStop', session: S, agent: 'a88888888888888888', cwd: D, sections: [{ title: 'final output', text: 'OLD-PROSE-LAST' }], id: 'h-old' }], now);
  const o = createOffice(cfg), srv = o.app.listen(0, '127.0.0.1'); await new Promise(r => srv.once('listening', r));
  try {
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, evs = (await (await fetch(base + '/api/events?op=*')).json()).events.filter((e: any) => e.source.includes('/spool/'));
    let def = '', third = ''; for (const e of evs) { def += await (await fetch(base + '/api/expand/event/' + e.id)).text(); third += await (await fetch(base + '/api/expand/event/' + e.id + '/prose')).text(); }
    for (const m of ['OLD-PROSE-MSG', 'OLD-PROSE-REASON', 'OLD-PROSE-FINAL', 'OLD-PROSE-LAST']) { assert.ok(!def.includes(m), 'default Expand shows ' + m); assert.ok(third.includes(m), 'third click lacks ' + m); }
  } finally { await new Promise(r => srv.close(r)); }
});
