import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config, Allowlist } from '../collect/privacy';
import { appendBoard, readBoard, pageBoard, mentions, visibleMessage } from '../board';
import { cli } from '../board-cli';
import { createOffice } from '../server';
import { serve } from './serve';
const session = '12345678-1234-1234-1234-123456789abc';
function fixture(t: test.TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'office-board-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, OFFICE_HOME: root, OFFICE_ROOM: root, OFFICE_BOARD: path.join(root, 'board'), OFFICE_SESSIONS: path.join(root, 'sessions.json'), OFFICE_REPOS: root, CLAUDE_CODE_SESSION_ID: session };
  fs.writeFileSync(env.OFFICE_SESSIONS, JSON.stringify({ version: 1, entries: [{ session, role: 'engineer', since: '2026-01-01' }] }));
  return { root, env, cfg: config(env) };
}
const human = { role: 'deniz', kind: 'human' as const };
test('board: missing directory stays missing on reads and Office startup; raw board files cannot expand', t => {
  const { cfg } = fixture(t); assert.deepEqual(readBoard(cfg, 'work'), []); createOffice(cfg); assert.equal(fs.existsSync(cfg.board!), false);
  appendBoard(cfg, 'work', { text: 'private stored marker' }, human);
  assert.equal(new Allowlist(cfg).read(path.join(cfg.board!, 'work.jsonl')).content, undefined);
});
test('board: append-only, paging, mentions, literal HTML and validation', t => {
  const { cfg } = fixture(t); const m = appendBoard(cfg, 'work', { text: '<script>alert(1)</script> @operator @critic @intern @operator x@partner @partner-extra' }, human);
  assert.equal(m.text.startsWith('<script>'), true); assert.deepEqual(m.mentions, ['operator', 'intern', 'operator']);
  assert.deepEqual(mentions('@jev-correspondent @brainstormer @coordinator @partner @experimenter @engineer @prompter'), ['jev-correspondent', 'brainstormer', 'coordinator', 'partner', 'experimenter', 'engineer', 'prompter']);
  const before = fs.readFileSync(path.join(cfg.board!, 'work.jsonl'), 'utf8');
  for (let i = 0; i < 105; i++) appendBoard(cfg, 'work', { text: `post ${i}`, replyTo: m.id }, human);
  assert.ok(fs.readFileSync(path.join(cfg.board!, 'work.jsonl'), 'utf8').startsWith(before));
  assert.equal(pageBoard(cfg, 'work').length, 100); assert.deepEqual(pageBoard(cfg, 'work', m.id, 2).map(m => m.id), ['w-000002', 'w-000003']);
  assert.equal(appendBoard(cfg, 'leisure', { text: 'a\n\nb' }, human).id, 'l-000001');
  for (const body of [{ text: 'x'.repeat(2001) }, { text: 'a\nb\nc' }, { text: 'ok', author: human }, { text: 'ok', replyTo: 'l-000001' }]) assert.throws(() => appendBoard(cfg, 'work', body, human));
  assert.throws(() => appendBoard(cfg, 'work', { text: 'no' }, { role: 'partner', kind: 'standin' }), /Stand-in/);
  assert.throws(() => pageBoard(cfg, 'work', '../x')); assert.throws(() => pageBoard(cfg, 'work', undefined, 0));
});
test('board: withholding checks text, links, encoded paths, blind paths and redaction; never reads linked content', t => {
  const { cfg, root } = fixture(t), allow = new Allowlist(cfg);
  allow.blind = p => p.includes('/work/sealed/');
  for (const p of ['restricted/key.md', 'archive/private/a.md', 'archive/personality/a.md', '.room-data/a', 'roles/partner/deniz-model.md', 'deniz-model.md', 'labels/a', 'conversation-01.md', 'work/sealed/a.json', 'restricted%2Fkey.md']) {
    for (const body of [{ text: `see (${p})`, link: 'safe-node' }, { text: 'innocent', link: p }]) {
      const m = appendBoard(cfg, 'work', body, human), v = visibleMessage(m, allow); assert.equal(v.text, 'withheld by the Office deny-list', p); assert.equal(v.link, undefined); assert.deepEqual(readBoard(cfg, 'work').at(-1), m);
    }
  }
  const file = path.join(root, 'public.md'); fs.writeFileSync(file, 'FILE CONTENT MUST NEVER APPEAR');
  const m = visibleMessage(appendBoard(cfg, 'work', { text: 'mail someone@example.org', link: file }, human), allow);
  assert.ok(!JSON.stringify(m).includes('someone@example.org')); assert.ok(!JSON.stringify(m).includes('FILE CONTENT'));
});
test('board: CLI registration, spoofing, leisure restrictions and compact capped tail', t => {
  const { env, cfg } = fixture(t);
  assert.match(cli('post', ['work', 'hi'], { ...env, CLAUDE_CODE_SESSION_ID: '' }).out, /Unregistered/);
  for (const args of [['work', 'hi', '--author', 'standin'], ['work', 'hi', '--kind', 'standin'], ['leisure', 'hi @operator'], ['leisure', 'hi @critic']]) assert.equal(cli('post', args, env).code, 1);
  assert.equal(cli('post', ['work', 'hi @operator', '--link', 'office-message-board'], env).code, 0); assert.deepEqual(readBoard(cfg, 'work')[0].author, { role: 'engineer', kind: 'session' });
  assert.equal(cli('post', ['leisure', 'hi'], env).code, 0);
  assert.equal(cli('tail', ['tail', 'leisure'], env).code, 1); assert.equal(cli('tail', ['tail', 'leisure', '--human'], env).code, 1);
  assert.equal(cli('tail', ['tail', 'leisure'], { ...env, OFFICE_BOARD_ALLOW_LEISURE: '1' }).code, 1);
  assert.equal(cli('tail', ['tail', 'leisure', '--human'], { ...env, OFFICE_BOARD_ALLOW_LEISURE: '1' }).code, 0);
  assert.ok(cli('tail', ['tail', 'work', '--max-chars', '30'], env).out.length < 30);
  fs.writeFileSync(env.OFFICE_SESSIONS, JSON.stringify({ entries: [{ session, role: 'partner (standin)', since: '2026-01-01' }] }));
  assert.equal(cli('post', ['work', 'hi'], env).code, 1);
});
test('board: parallel executable office-post processes allocate monotonic IDs without lost writes', async t => {
  const { env, cfg } = fixture(t);
  await Promise.all(Array.from({ length: 16 }, (_, i) => new Promise<void>((resolve, reject) => {
    const child = spawn(path.join(__dirname, '../bin/office-post'), ['work', `parallel ${i}`], { env, cwd: os.tmpdir() }); let err = '';
    child.stderr.on('data', b => err += b); child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(err)));
  })));
  const rows = readBoard(cfg, 'work'); assert.equal(rows.length, 16); assert.equal(new Set(rows.map(m => m.text)).size, 16);
  assert.deepEqual(rows.map(m => m.id), Array.from({ length: 16 }, (_, i) => `w-${String(i + 1).padStart(6, '0')}`));
  await new Promise<void>((resolve, reject) => { const child = spawn(path.join(__dirname, '../bin/office-board'), ['tail', 'work', '--lines', '2'], { env, cwd: os.tmpdir() }); let out = ''; child.stdout.on('data', b => out += b); child.on('error', reject); child.on('exit', c => { try { assert.equal(c, 0); assert.equal(out.trim().split('\n').length, 2); resolve(); } catch (e) { reject(e); } }); });
});
test('board HTTP: POST security, GET paging, withholding, raw-file protection and rate limit', async t => {
  const { cfg } = fixture(t), s = await serve(cfg); t.after(() => s.close());
  const post = (body: any, headers: Record<string, string> = {}, room = 'work') => fetch(s.base + '/api/board/' + room, { method: 'POST', headers: { origin: s.base, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.deepEqual(JSON.parse((await s.get('/api/board/work')).text), { messages: [] });
  assert.equal((await post({ text: 'x' }, { origin: 'https://foreign.example' })).status, 403);
  assert.equal((await post({ text: 'x' }, { origin: '' })).status, 403);
  assert.equal((await post({ text: 'x' }, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await post({ text: 'x', author: human })).status, 400);
  assert.equal((await post({ text: 'x'.repeat(2001) })).status, 400);
  assert.equal((await post({ text: 'x'.repeat(20000) })).status, 413);
  assert.equal((await post({ text: 'x' }, {}, 'unknown')).status, 404);
  const r = await post({ text: 'restricted/secret.md', link: 'safe' }); assert.equal(r.status, 201); const m = (await r.json()).message; assert.equal(m.text, 'withheld by the Office deny-list'); assert.equal(m.link, undefined); assert.deepEqual(m.author, human);
  await post({ text: '<b>plain text</b>' });
  const paged = JSON.parse((await s.get('/api/board/work?after=w-000001&limit=1')).text).messages; assert.equal(paged[0].id, 'w-000002');
  const raw = JSON.parse((await s.get('/api/expand/file?path=' + encodeURIComponent(path.join(cfg.board!, 'work.jsonl')))).text); assert.equal(raw.content, undefined);
  assert.equal((await fetch(s.base + '/api/summary', { method: 'POST' })).status, 405);
  let rate = false; for (let i = 0; i < 31; i++) if ((await post({ text: 'ok' })).status === 429) { rate = true; break; } assert.equal(rate, true);
});
