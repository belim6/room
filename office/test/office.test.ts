import { serve } from './serve';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { collect } from '../collect/index';
import { Allowlist, redact, redactDeep, type Config } from '../collect/privacy';
import { actorContext, expandEvent } from '../collect/expand';
import { createOffice } from '../server';
import { shellFacts } from '../collect/shell';

// Fixtures are trimmed real-format records (transcripts, Codex logs, manifests) with paths remapped to __ROOT__.
// Each test works on a temp copy; secrets are planted at runtime so no secret-shaped string sits in the repo.
const FIX = path.join(__dirname, 'fixtures'), S = '83d97c5f-df8e-4f7d-a0d0-63a07139e561';
const roots: string[] = [];
test.after(() => roots.forEach(r => fs.rmSync(r, { recursive: true, force: true })));
const SECRETS: Record<string, string> = {
  anthropic: 'sk-' + 'ant-api03-' + 'Aq7'.repeat(14), openai: 'sk-' + 'proj-' + 'Bz9'.repeat(14), github: 'gh' + 'p_' + 'Cx4'.repeat(12),
  bearer: 'Dw2'.repeat(11) + '.sig', basic: 'Ev5'.repeat(9), apikey: 'Fu6'.repeat(10), env: 'pg-Gt8Gt8Gt8', hex: 'a1b2c3d4e5f6'.repeat(4),
  b64: 'Hs1Hs1Hs1Hs1Hs1Hs1Hs1/+ab==', email: 'someone.else@example.org', password: 'Ir3'.repeat(8), aws: 'AKIA' + 'JQ3JQ3JQ3JQ3JQ3J',
  jsonKey: 'c0ffee12'.repeat(8), escBasic: 'Kb7Kb7Kb7Kb7Kb7', jsonEnv: 'Lp4Lp4Lp4Lp4', together: 'tgp_' + 'v1_' + 'Mn5'.repeat(12),
};
const secretText = () => [
  `anthropic ${SECRETS.anthropic}`, `openai ${SECRETS.openai}`, `gh ${SECRETS.github}`, `curl -H "Authorization: Bearer ${SECRETS.bearer}"`, `Authorization: Basic ${SECRETS.basic}`,
  `export OPENGATEWAY_API_KEY=${SECRETS.apikey}`, `DATABASE_URL=${SECRETS.env}`, `secret: ${SECRETS.hex}`, `token=${SECRETS.b64}`, `mail ${SECRETS.email} or osmanabuziddin@gmail.com`,
  `password: ${SECRETS.password}`, `aws ${SECRETS.aws}`, `{"TOGETHER_API_KEY": "${SECRETS.jsonKey}"}`, `{\\"Authorization\\": \\"Basic ${SECRETS.escBasic}\\"}`,
  `"config": "HOST=x\\nDB_PASS=${SECRETS.jsonEnv}\\nPORT=1"`, `together ${SECRETS.together}`].join('\n');

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'office-test-'))); roots.push(root);
  const copy = (from: string, to: string) => { for (const n of fs.readdirSync(from)) { const a = path.join(from, n), b = path.join(to, n);
    if (fs.statSync(a).isDirectory()) { fs.mkdirSync(b, { recursive: true }); copy(a, b); } else fs.writeFileSync(b, fs.readFileSync(a, 'utf8').split('__ROOT__').join(root)); } };
  copy(FIX, root);
  const sec = secretText(), D = path.join(root, 'coordination/2026-10-17/date');
  // plant: coordination file, transcript tool call + output + text, Codex exec output, handoff note, off-allowlist file
  fs.writeFileSync(path.join(root, 'coordination/2026-10-17/secrets-note.md'), '# notes\n' + sec + '\n');
  fs.writeFileSync(path.join(root, 'outside/notes.txt'), 'plain notes outside the allowlist\n' + sec + '\n');
  const sess = path.join(root, 'proj', S + '.jsonl'), cwd = D;
  const rec = (o: any) => JSON.stringify({ parentUuid: null, isSidechain: false, cwd, sessionId: S, ...o }) + '\n';
  fs.appendFileSync(sess, rec({ type: 'assistant', uuid: 'f3-1', timestamp: '2026-10-17T17:43:00.000Z', message: { id: 'msg_sec', role: 'assistant', content: [
    { type: 'thinking', thinking: 'the key is ' + SECRETS.openai, signature: 'x' }, { type: 'text', text: 'note to Deniz: ' + sec },
    { type: 'tool_use', id: 'toolu_sec', name: 'Bash', input: { command: `cat ${D}/labeler-prompt.md; echo "${SECRETS.anthropic}"; curl -H "Authorization: Bearer ${SECRETS.bearer}" http://127.0.0.1:4317/api/bootstrap`, description: 'planted' } }] } }));
  fs.appendFileSync(sess, rec({ type: 'user', uuid: 'f3-2', timestamp: '2026-10-17T17:43:01.000Z', message: { role: 'user', content: [{ tool_use_id: 'toolu_sec', type: 'tool_result', content: sec }] } }));
  // commands whose output the parser can't verify: their (off-allowlist) output must be withheld
  const codexHome = path.join(root, 'home/.codex/sessions'); fs.mkdirSync(codexHome, { recursive: true }); fs.writeFileSync(path.join(codexHome, 's.jsonl'), 'OFFLIST-CODEX-MARKER');
  const bash = (id: string, ts: string, command: string, out: string, at = cwd) => {
    fs.appendFileSync(sess, rec({ type: 'assistant', uuid: id + '-u', timestamp: ts, cwd: at, message: { id: 'msg_' + id, role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command, description: id } }] } }));
    fs.appendFileSync(sess, rec({ type: 'user', uuid: id + '-r', timestamp: ts.replace(/\.000Z$/, '.500Z'), cwd: at, message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: out }] } })); };
  bash('toolu_var', '2026-10-17T17:43:10.000Z', 'for f in ~/.codex/sessions/*; do cat "$f"; done', 'OFFLIST-VAR-MARKER');
  bash('toolu_cd', '2026-10-17T17:43:11.000Z', 'cd ~/.codex/sessions && cat s.jsonl', 'OFFLIST-CD-MARKER');
  bash('toolu_node', '2026-10-17T17:43:12.000Z', `node -e "console.log(require('fs').readFileSync(process.env.HOME+'/.codex/auth.json','utf8'))"`, 'OFFLIST-NODE-MARKER');
  bash('toolu_offcwd', '2026-10-17T17:43:13.000Z', 'cat s.jsonl', 'OFFLIST-CWD-MARKER', codexHome);
  bash('toolu_ok', '2026-10-17T17:43:14.000Z', 'cat labeler-prompt.md | head -3', 'VERIFIED-OUTPUT-MARKER');
  // critic cases: recursion, non-literal cd, off-allowlist writes (Bash and Write tool)
  bash('toolu_rec', '2026-10-17T17:43:15.000Z', 'grep -R SECRET .', 'RECURSIVE-MARKER');
  bash('toolu_cddash', '2026-10-17T17:43:16.000Z', 'cd - && cat X', 'CDDASH-MARKER');
  bash('toolu_echo', '2026-10-17T17:43:17.000Z', 'echo WRITE-PAYLOAD-MARKER >> ~/off/path', '');
  fs.appendFileSync(sess, rec({ type: 'assistant', uuid: 'f5-1', timestamp: '2026-10-17T17:43:18.000Z', message: { id: 'msg_w', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_write_off', name: 'Write', input: { file_path: path.join(root, 'home/off/notes.md'), content: 'WRITETOOL-PAYLOAD-MARKER' } }] } }));
  fs.appendFileSync(sess, rec({ type: 'user', uuid: 'f5-2', timestamp: '2026-10-17T17:43:18.500Z', message: { role: 'user', content: [{ tool_use_id: 'toolu_write_off', type: 'tool_result', content: 'File created successfully at: WRITETOOL-RESULT-MARKER' }] } }));
  const crit = path.join(root, 'coordination/critic/critic-2026-10-17-date-baseline.raw.log');
  fs.writeFileSync(crit, fs.readFileSync(crit, 'utf8').replace('\ncodex\n**NO-GO', `\nexec\n/bin/zsh -lc 'for f in ../.room-data/trash/*; do\n  cat "$f"\ndone' in ${root}/room\n succeeded in 0ms:\nOFFLIST-TRASH-MARKER\n\ncodex\n**NO-GO`));
  const log = path.join(D, 'labels/codex/T-3911f729.log');
  fs.writeFileSync(log, fs.readFileSync(log, 'utf8').replace(' succeeded in 0ms:\n', ' succeeded in 0ms:\n' + sec + '\n'));
  fs.appendFileSync(path.join(root, 'coordination/events.jsonl'), JSON.stringify({ at: '2026-10-17T18:00:00Z', from: 'critic', to: 'claude', kind: 'review', ref: '2026-10-17/secrets-note.md', note: 'NO-GO ' + SECRETS.github }) + '\n');
  const at = new Date('2026-10-17T17:42:17Z'); fs.utimesSync(log, at, at);
  const cfg: Config = { home: path.join(root, 'home'), coordination: path.join(root, 'coordination'), promptKnowledge: path.join(root, 'pk'), roomData: path.join(root, 'room-data'),
    claudeProject: path.join(root, 'proj'), coordinatorSession: S };
  return { root, cfg };
}
// Every GET the page can make: summary, events, artifacts, every event expanded, every artifact/target file expanded.
async function crawl(s: Awaited<ReturnType<typeof serve>>, extraPaths: string[] = []) {
  const bodies: string[] = []; const g = async (u: string) => { const r = await s.get(u); bodies.push(r.text); return r; };
  await g('/api/summary'); const ev = JSON.parse((await g('/api/events?op=*')).text).events; await g('/api/artifacts?op=*');
  for (const e of ev) await g('/api/expand/event/' + e.id);
  const paths = new Set<string>([...ev.filter((e: any) => e.target?.path).map((e: any) => e.target.path), ...JSON.parse((await g('/api/artifacts?op=*')).text).map((a: any) => a.path), ...extraPaths]);
  for (const p of paths) await g('/api/expand/file?path=' + encodeURIComponent(p));
  return { bodies, all: bodies.join('\n'), events: ev };
}
const snapshot = (root: string) => { const m: Record<string, number> = {}; const w = (d: string) => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n), st = fs.lstatSync(p); m[p] = st.mtimeMs; if (st.isDirectory()) w(p); } }; w(root); m[root] = fs.lstatSync(root).mtimeMs; return m; };

test('parsers: claude session, sub-agent, codex labeler, critic, handoffs, manifest, driver-state, missing labels', () => {
  const { root, cfg } = fixture(), c = collect(cfg), E = c.events, A = c.actors;
  const kinds = Object.fromEntries(c.sources.map(s => [s.kind, 0])); for (const s of c.sources) kinds[s.kind] += s.events;
  for (const k of ['claude-session', 'claude-subagent', 'codex-labeler-log', 'codex-critic-log', 'coordination-events', 'driver-manifest', 'driver-state']) assert.ok(k in kinds, 'source parsed: ' + k);
  // coordinator session
  assert.ok(E.some(e => e.actor.id === 'deniz' && e.verb === 'message' && e.target?.id === 'coordinator'), 'Deniz message');
  const bg = E.find(e => e.detailRef.key === 'toolu_01PvmrMZ3Zv5HS9QNtebrEhZ' && e.verb === 'dispatch')!; assert.equal(bg.target?.id, 'providers'); assert.equal(bg.outcome, 'background');
  const spawn = E.find(e => e.detailRef.key === 'toolu_017iFRjaYwHe3daAabj6XT6B')!; assert.equal(spawn.verb, 'spawn'); assert.equal(spawn.target?.id, 'agent:ad5030270006e2618'); assert.equal(spawn.provenance, 'captured');
  assert.ok(E.some(e => e.actor.id === 'agent:ad5030270006e2618' && e.verb === 'message' && e.label === 'result: completed'), 'task notification');
  // sub-agent: ephemeral labeler, linked to the Agent tool_use, opens its 3 files (+ one off-allowlist), writes its verdict, ends
  const lab = A.get('agent:ad5030270006e2618')!; assert.equal(lab.kind, 'labeler'); assert.equal(lab.parent, 'coordinator'); assert.equal(lab.label, 'Label T-3911f729'); assert.equal(lab.operation, '2026-10-17/date/labeling');
  const own = E.filter(e => e.actor.id === lab.id);
  assert.deepEqual(own.filter(e => e.verb === 'read').map(e => path.relative(root, e.target!.path!)), ['coordination/2026-10-17/date/labeler-prompt.md', 'coordination/2026-10-17/date/blind/T-3911f729.md', 'coordination/2026-10-17/date/rubric-v1.md', 'outside/notes.txt']);
  assert.deepEqual(own.filter(e => e.verb === 'write').map(e => path.basename(e.target!.path!)), ['T-3911f729.json']);
  const end = own.find(e => e.verb === 'end')!; assert.equal(end.outcome, 'done'); assert.ok(end.cost!.tokens! > 0 && end.cost!.calls! > 0);
  // codex labeler: derived, launch linked to the coordinator call, exactly its 3 files, verdict, tokens
  const cid = 'codex:2026-10-17/date/labels/codex/T-3911f729', cx = E.filter(e => e.actor.id === cid || e.target?.id === cid);
  const cs = cx.find(e => e.verb === 'spawn')!; assert.equal(cs.tsSource, 'linked'); assert.equal(cs.ts, '2026-10-17T17:41:50.166Z'); assert.equal(cs.provenance, 'derived');
  assert.deepEqual(cx.filter(e => e.verb === 'read').map(e => path.basename(e.target!.path!)), ['labeler-prompt.md', 'T-3911f729.md', 'rubric-v1.md']);
  assert.ok(cx.filter(e => e.verb === 'read').every(e => e.provenance === 'derived'));
  const ce = cx.find(e => e.verb === 'end')!; assert.equal(ce.outcome, 'verdict'); assert.equal(ce.cost!.tokens, 3469); assert.equal(ce.ts, '2026-10-17T17:42:17.000Z'); assert.equal(ce.tsSource, 'mtime');
  assert.match(c.sources.find(s => s.path.endsWith('T-3911f729.log'))!.note!, /1 preamble/);
  // critic session: NO-GO is an outcome, not just activity
  const cr = E.find(e => e.actor.id === 'critic:critic-2026-10-17-date-baseline' && e.verb === 'end')!; assert.equal(cr.outcome, 'no-go'); assert.equal(cr.cost!.tokens, 41207);
  assert.equal(E.find(e => e.target?.id === 'critic:critic-2026-10-17-date-baseline' && e.verb === 'spawn')!.provenance, 'inferred');
  // handoffs
  const h = E.filter(e => e.detailRef.kind === 'handoff'); assert.equal(h.length, 4); assert.ok(h.every(e => e.provenance === 'captured'));
  assert.deepEqual(h.map(e => e.verb), ['dispatch', 'message', 'message', 'message']); assert.equal(h[3].outcome, 'no-go');
  assert.equal(c.sources.find(s => s.kind === 'coordination-events')!.unparsed, 1); assert.equal(c.sources.find(s => s.kind === 'claude-session')!.unparsed, 1);
  // manifest + driver state: one turn, one unknown kind reported as unparsed, never guessed
  const man = c.sources.find(s => s.kind === 'driver-manifest')!; assert.equal(man.unparsed, 2); // unknown kind + malformed timestamp
  const turn = E.find(e => e.verb === 'turn')!; assert.equal(turn.actor.id, 'server'); assert.equal(turn.target?.id, '2c181537-f8f7-4d5f-b598-6ae7c3e721f7'); assert.equal(turn.operation, '2026-10-17/date/run-baseline');
  assert.equal(c.sources.find(s => s.kind === 'driver-state')!.unparsed, 0);
  // the second transcript has no labels from either family: two failure events
  assert.deepEqual(E.filter(e => e.detailRef.kind === 'missing-label').map(e => e.label).sort(), ['missing claude label T-00000000', 'missing codex label T-00000000']);
});

test('shell facts: reads, writes, cd, heredocs', () => {
  const f = shellFacts("cd /r/c; cat a.md blind/T-1.md rubric.md | head -5; sed -n 1,40p x.json; grep -n foo y.log; cat > out.md <<'EOF'\nbody > notes.md\nEOF\necho hi >> log.txt", '/', '/h');
  assert.deepEqual(f.reads, ['/r/c/a.md', '/r/c/blind/T-1.md', '/r/c/rubric.md', '/r/c/x.json', '/r/c/y.log']); assert.deepEqual(f.writes, ['/r/c/out.md', '/r/c/log.txt']);
});

test('privacy gate: planted secrets of every pattern never appear in any API response', async () => {
  const { root, cfg } = fixture(), s = await serve(cfg);
  try {
    const { all, bodies } = await crawl(s, [path.join(root, 'outside/notes.txt')]);
    assert.ok(bodies.length > 20);
    for (const [k, v] of Object.entries(SECRETS)) assert.ok(!all.includes(v), `secret ${k} leaked`);
    for (const kind of ['anthropic-key', 'api-key', 'github-token', 'authorization', 'key-assignment', 'env-value', 'secret', 'email', 'aws-key', 'together-key']) assert.ok(all.includes(`[redacted: ${kind}]`), 'redaction kind shown: ' + kind);
    assert.ok(all.includes('osmanabuziddin@gmail.com'), "Deniz's own address is kept");
  } finally { await s.close(); }
  for (const v of Object.values(SECRETS)) assert.ok(!redact(secretText()).includes(v));
});

test('privacy gate: summary tier is metadata only; content needs Expand', async () => {
  const { cfg } = fixture(), s = await serve(cfg);
  try {
    const ev = JSON.parse((await s.get('/api/events?op=*')).text).events, sum = (await s.get('/api/summary')).text + JSON.stringify(ev);
    assert.ok(ev.every((e: any) => !('hints' in e)), 'no command/prompt text in summaries');
    for (const t of ['You are a careful, independent annotator', 'figured I', 'Read ONLY these files', 'note to Deniz']) assert.ok(!sum.includes(t), 'content in summary: ' + t);
    const lab = ev.find((e: any) => e.actor.id === 'agent:ad5030270006e2618' && e.verb === 'end');
    const x = JSON.parse((await s.get('/api/expand/event/' + lab.id)).text);
    assert.ok(x.sections.some((q: any) => q.title === 'prompt' && /Read ONLY these files/.test(q.text)));
    assert.ok(x.sections.some((q: any) => q.title === 'read' && /T-3911f729\.md$/.test(q.path) && /Transcript T-3911f729/.test(q.text)));
    assert.ok(x.sections.some((q: any) => q.title === 'final output'));
  } finally { await s.close(); }
});

test('privacy gate: off-allowlist, traversal and symlink escapes return the path only', async () => {
  const { root, cfg } = fixture(), C = path.join(root, 'coordination');
  fs.symlinkSync(path.join(root, 'outside/notes.txt'), path.join(C, '2026-10-17/link-out.md'));
  fs.symlinkSync(path.join(root, 'outside'), path.join(C, 'linkdir'));
  fs.mkdirSync(path.join(root, 'room-data/observations')); fs.writeFileSync(path.join(root, 'room-data/observations/o.json'), '{"x":"observation"}');
  fs.mkdirSync(path.join(root, 'proj/memory')); fs.writeFileSync(path.join(root, 'proj/memory/m.md'), 'memory');
  const al = new Allowlist(cfg);
  assert.equal(al.allows(path.join(C, '2026-10-17/date/rubric-v1.md')), true);
  assert.equal(al.allows(path.join(root, 'room-data/revisions/353c38e6-5dca-407d-b6b0-0f3db51a993d.json')), true);
  for (const p of [path.join(root, 'outside/notes.txt'), path.join(C, '2026-10-17/link-out.md'), path.join(C, 'linkdir/notes.txt'), path.join(C, '../outside/notes.txt'), C + '/2026-10-17/../../outside/notes.txt',
    path.join(root, 'room-data/observations/o.json'), path.join(root, 'proj/memory/m.md'), path.join(C, 'linkdir/new-file.md'), '/etc/hosts', '~/.ssh/id_rsa'])
    assert.equal(al.allows(p), false, 'must be refused: ' + p);
  const s = await serve(cfg);
  try {
    for (const p of [path.join(C, '2026-10-17/link-out.md'), path.join(C, 'linkdir/notes.txt'), C + '/../outside/notes.txt', path.join(root, 'room-data/observations/o.json')]) {
      const r = JSON.parse((await s.get('/api/expand/file?path=' + encodeURIComponent(p))).text); assert.equal(r.allowed, false); assert.equal(r.content, undefined);
    }
    const { all, events } = await crawl(s);
    assert.ok(!all.includes('plain notes outside the allowlist'), 'off-allowlist content never served');
    for (const m of ['OFFLIST-CODEX-MARKER', 'OFFLIST-VAR-MARKER', 'OFFLIST-CD-MARKER', 'OFFLIST-NODE-MARKER', 'OFFLIST-CWD-MARKER', 'OFFLIST-TRASH-MARKER']) assert.ok(!all.includes(m), 'unverifiable output leaked: ' + m);
    assert.ok(all.includes('output withheld (unverifiable)'));
    const off = events.find((e: any) => e.target?.path === path.join(root, 'outside/notes.txt'))!; const x = JSON.parse((await s.get('/api/expand/event/' + off.id)).text);
    assert.equal(x.sections[0].allowed, false); assert.equal(x.sections[0].path, path.join(root, 'outside/notes.txt'));
    const ok = events.find((e: any) => e.detailRef.key === 'toolu_ok')!; assert.ok(JSON.parse((await s.get('/api/expand/event/' + ok.id)).text).sections.some((q: any) => q.title === 'output' && q.text.includes('VERIFIED-OUTPUT-MARKER')), 'a verifiable command shows its output');
  } finally { await s.close(); }
});

test('read-only gate: source trees unchanged after collect, every API call and a full replay; board is the sole write route', async () => {
  const { root, cfg } = fixture(), before = snapshot(root);
  await new Promise(r => setTimeout(r, 20));
  const s = await serve(cfg), M: any = await import(path.join(__dirname, '../web/model.mjs'));
  try {
    const { events } = await crawl(s, [path.join(root, 'outside/notes.txt')]); await s.get('/api/recollect');
    const actors = JSON.parse((await s.get('/api/summary')).text).actors, tl = M.timeline(events);
    for (let c = 0; c <= tl.duration; c += Math.max(1, tl.duration / 200)) M.stateAt(events, actors, tl.toReal(c));
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) for (const u of ['/api/summary', '/api/expand/file?path=x', '/api/recollect', '/', '/api/nope']) {
      const r = await fetch(s.base + u, { method: m, body: m === 'DELETE' ? undefined : '{}', headers: { 'content-type': 'application/json' } }); assert.equal(r.status, 405, `${m} ${u}`);
    }
  } finally { await s.close(); }
  assert.deepEqual(snapshot(root), before);
  const { app } = createOffice(cfg), routes = (app as any)._router.stack.filter((l: any) => l.route).map((l: any) => Object.keys(l.route.methods));
  assert.ok(routes.length >= 6); for (const ms of routes) assert.ok(JSON.stringify(ms) === '["get"]' || JSON.stringify(ms) === '["post"]');
  assert.deepEqual((app as any)._router.stack.filter((l: any) => l.route?.methods.post).map((l: any) => l.route.path), ['/api/board/leisure/state', '/api/board/:room']);
});

test('replay determinism: same records, same events; same t, same floor state', async () => {
  const { cfg } = fixture(), M: any = await import(path.join(__dirname, '../web/model.mjs'));
  const strip = (c: ReturnType<typeof collect>) => JSON.stringify({ e: c.events, o: c.operations });
  const a = collect(cfg), b = collect(cfg); assert.equal(strip(a), strip(b));
  const ev = JSON.parse(JSON.stringify(a.events)), actors = [...a.actors.values()], ser = (s: any) => JSON.stringify({ a: [...s.actors].sort(), e: s.edges, m: s.marks });
  const lab = ev.filter((e: any) => e.operation?.startsWith('2026-10-17/date/labeling')), tl = M.timeline(lab);
  for (const f of [0, 0.1, 0.33, 0.5, 0.77, 1]) { const t = tl.toReal(tl.duration * f); assert.equal(ser(M.stateAt(lab, actors, t)), ser(M.stateAt(lab, actors, t))); }
  assert.deepEqual([...M.layout(lab, actors).pos], [...M.layout(lab, actors).pos]);
  // after the labeling: both labelers ended with a verdict; mid-way the Claude labeler is open, the coordinator is a permanent node
  const after = M.stateAt(lab, actors, Date.parse('2026-10-17T17:43:00Z')), mid = M.stateAt(lab, actors, Date.parse('2026-10-17T17:42:04.5Z'));
  assert.equal(after.actors.get('agent:ad5030270006e2618').state, 'ended'); assert.equal(after.actors.get('codex:2026-10-17/date/labels/codex/T-3911f729').outcome, 'verdict');
  assert.ok(['active', 'open'].includes(mid.actors.get('agent:ad5030270006e2618').state));
  assert.equal(M.stateAt(lab, actors, Date.parse('2026-10-17T17:41:00Z')).actors.size, 0, 'nothing shown before the first event');
  // compressed clock is monotone and invertible on event times
  for (const e of lab) assert.ok(Math.abs(tl.toReal(tl.toComp(Date.parse(e.ts))) - Date.parse(e.ts)) < 2);
});

test('coverage gate: badge counts and gaps on a fixture with known gaps (both directions)', () => {
  const { cfg } = fixture(), c = collect(cfg), op = (id: string) => c.operations.find(o => o.id === id)!;
  const gaps = c.events.filter(e => e.gap);
  assert.deepEqual(gaps.map(g => [g.gap!.direction, g.operation]).sort(), [['action-without-log', '2026-10-17/date'], ['log-without-action', '2026-10-17']]);
  assert.equal(op('2026-10-17').coverage.gaps, 2); assert.equal(op('2026-10-17/date').coverage.gaps, 1); assert.equal(op('2026-10-17/date/labeling').coverage.gaps, 0);
  for (const o of c.operations) { const k = o.coverage; assert.equal(k.captured + k.derived + k.inferred + k.gaps, k.events, o.id);
    const evs = c.events.filter(e => e.operation === o.id || e.operation?.startsWith(o.id + '/'));
    assert.equal(k.derived, evs.filter(e => !e.gap && e.provenance === 'derived').length); assert.equal(k.captured, evs.filter(e => !e.gap && e.provenance === 'captured').length); }
  // the matched handoff (codex dispatch) produced no gap; the ghost packet did
  assert.ok(gaps.find(g => g.gap!.direction === 'log-without-action')!.label!.includes('packet'));
  // workflow data model keeps the template apart from the observed run
  const w = op('2026-10-17/date').workflow; assert.equal(w.template.source, 'template'); assert.equal(w.run.source, 'events'); assert.ok(w.run.steps.some(s => s.step === 'label'));
});

test('review fixes: raw sources are never served whole through expand/file', async () => {
  const { root, cfg } = fixture(), s = await serve(cfg), all: string[] = [];
  const walk = (d: string) => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); fs.statSync(p).isDirectory() ? walk(p) : all.push(p); } };
  walk(path.join(root, 'proj')); walk(path.join(root, 'coordination'));
  try {
    for (const p of all) {
      const r = JSON.parse((await s.get('/api/expand/file?path=' + encodeURIComponent(p))).text), raw = /\.(jsonl|log)$/.test(p) && !/events\.jsonl$|manifest-/.test(p) || p.includes('/proj/');
      if (raw) { assert.equal(r.allowed, false, p); assert.equal(r.content, undefined, p); }
    }
    const al = new Allowlist(cfg);
    assert.equal(al.isTranscript(path.join(root, 'proj', S + '.jsonl')), true); assert.equal(al.isTranscript(path.join(root, 'proj', S, 'subagents/agent-ad5030270006e2618.jsonl')), true);
    assert.equal(al.isTranscript(path.join(root, 'proj', S, 'subagents/workflows/wf_fixture/journal.jsonl')), false);
    assert.equal(al.group(path.join(root, 'proj', S + '.jsonl')), 'transcripts');
  } finally { await s.close(); }
});

test('review fixes: escaped and JSON-quoted secrets; paths only get key-prefix redaction', () => {
  const t = redact(secretText());
  for (const k of ['jsonKey', 'escBasic', 'jsonEnv', 'together']) assert.ok(!t.includes(SECRETS[k]), k);
  assert.ok(t.includes('\\nPORT=[redacted: env-value]') && t.includes('\\nDB_PASS=[redacted:'), 'env lines after a literal \\n');
  const v = redactDeep({ path: '/r/token/abcdefghijklmnopqrstuvwxyz0123.md', text: 'token abcdefghijklmnopqrstuvwxyz0123', id: '/r/' + SECRETS.together });
  assert.equal(v.path, '/r/token/abcdefghijklmnopqrstuvwxyz0123.md'); assert.match(v.text, /redacted: secret/); assert.ok(!v.id.includes(SECRETS.together));
});

test('review fixes: an action that logs itself in the same call is not a gap; malformed timestamps are unparsed', () => {
  const { cfg } = fixture(), c = collect(cfg);
  const shared = c.events.filter(e => e.detailRef.key === 'toolu_shared' || String(e.detailRef.extra?.ref || '').endsWith('71-shared-call.md'));
  assert.ok(shared.length >= 2); assert.ok(!c.events.some(e => e.gap && (e.gap.ref === '71-shared-call' || shared.some(x => x.id === e.detailRef.extra?.of))));
});

test('review fixes: a symlink swapped in between check and open is refused (file and parent directory)', async () => {
  const { root, cfg } = fixture(), C = path.join(root, 'coordination'), al = new Allowlist(cfg), f = path.join(C, '2026-10-17/date/rubric-v1.md');
  assert.ok(al.read(f).content?.includes('Boring rubric'));
  al.beforeOpen = (p) => { if (p === f) { fs.renameSync(f, f + '.moved'); fs.symlinkSync(path.join(root, 'outside/notes.txt'), f); } };
  const r1 = al.read(f); assert.equal(r1.content, undefined); assert.equal(r1.allowed, false);
  fs.unlinkSync(f); fs.renameSync(f + '.moved', f);
  const dir = path.join(C, '2026-10-17/date/blind'), evil = path.join(root, 'outside/blind'); fs.mkdirSync(evil); fs.writeFileSync(path.join(evil, 'T-3911f729.md'), 'OFFLIST-SWAP-MARKER');
  al.beforeOpen = (p) => { if (p.startsWith(dir)) { fs.renameSync(dir, dir + '.moved'); fs.symlinkSync(evil, dir); } };
  const r2 = al.read(path.join(dir, 'T-3911f729.md')); assert.equal(r2.content, undefined); assert.equal(r2.allowed, false);
  fs.unlinkSync(dir); fs.renameSync(dir + '.moved', dir);
  // and through the server's file route
  const o = createOffice(cfg), srv = o.app.listen(0, '127.0.0.1'); await new Promise(r => srv.once('listening', r));
  o.data.allow.beforeOpen = (p) => { if (p === f) { fs.renameSync(f, f + '.moved'); fs.symlinkSync(path.join(root, 'outside/notes.txt'), f); } };
  try { const r = await (await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/expand/file?path=${encodeURIComponent(f)}`)).json(); assert.equal(r.content, undefined); assert.equal(r.allowed, false); }
  finally { await new Promise(r => srv.close(r)); fs.unlinkSync(f); fs.renameSync(f + '.moved', f); }
});

test('review fixes: a Codex labeler shows its concatenated output once, not under each file', () => {
  const { cfg } = fixture(), c = collect(cfg);
  const secs = actorContext(c, 'codex:2026-10-17/date/labels/codex/T-3911f729', false);
  const outs = secs.filter((x: any) => x.title.startsWith('output')); assert.equal(outs.length, 1); assert.match(outs[0].text || '', /You are a careful/);
  // the multi-line critic command is parsed as one exec, and its output is withheld with a reason
  const ex = c.events.find(e => e.actor.id === 'critic:critic-2026-10-17-date-baseline' && e.detailRef.kind === 'codex-exec' && /for f in/.test((e.hints || []).join('')))!;
  // since the Office deny-list: an exec that names labels/ (blind material) is withheld whole
  const x = expandEvent(c, ex).sections; assert.ok(x.length === 1 && x[0].title === 'withheld' && x[0].allowed === false);
  const reads = secs.filter((x: any) => x.title === 'read'); assert.equal(reads.length, 3); assert.ok(reads.every((x: any) => x.text === undefined));
});

test('critic fixes: recursion, non-literal cd and off-allowlist writes are withheld (command text too for writes)', async () => {
  const { root, cfg } = fixture(), s = await serve(cfg);
  try {
    const { all, events } = await crawl(s);
    for (const m of ['RECURSIVE-MARKER', 'CDDASH-MARKER', 'WRITE-PAYLOAD-MARKER', 'WRITETOOL-PAYLOAD-MARKER', 'WRITETOOL-RESULT-MARKER']) assert.ok(!all.includes(m), 'leaked: ' + m);
    const x = async (key: string) => JSON.parse((await s.get('/api/expand/event/' + events.find((e: any) => e.detailRef.key === key).id)).text).sections;
    assert.match((await x('toolu_rec')).find((q: any) => q.title === 'output').note, /recursive or link-following/);
    assert.match((await x('toolu_cddash')).find((q: any) => q.title === 'output').note, /cd target is not a literal/);
    const echo = (await x('toolu_echo')).find((q: any) => q.title === 'command'); assert.equal(echo.text, undefined); assert.equal(echo.note, `writes to ${path.join(root, 'home/off/path')} (content withheld)`);
    const w = await x('toolu_write_off'); assert.equal(w.length, 1); assert.equal(w[0].allowed, false); assert.match(w[0].note, /writes to .*home\/off\/notes\.md \(content withheld\)/);
  } finally { await s.close(); }
  const v = (cmd: string) => require('../collect/shell').verifyCommand(cmd, path.join(root, 'coordination'), path.join(root, 'home'), () => true, () => true).ok;
  for (const cmd of ['grep -r x .', 'rg -L x', 'rg --follow x', 'ls -R', 'cd', 'cd ~', 'cd -', 'pushd x', 'popd', 'du -sh .', 'tree', 'find -L .']) assert.equal(v(cmd), false, cmd);
  assert.equal(v('cat a.md | head -3'), true);
});
