import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { collectBackground, type BackgroundOpts } from '../collect/background';
import { config } from '../collect/privacy';
import { createOffice } from '../server';

function fixture(t: test.TestContext) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'office-refresh-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const cfg = config({ OFFICE_HOME: home });
  fs.mkdirSync(path.dirname(cfg.operations!), { recursive: true });
  return cfg;
}
const writeOps = (file: string, title: string) => fs.writeFileSync(file, JSON.stringify([{ id: 'work', title, parent: null, goal: 'Goal', status: 'active', owner: 'Deniz', budget: {} }]));
class FakeWorker extends EventEmitter {
  terminated = 0;
  async terminate() { this.terminated++; return 0; }
}
const factory = (worker: FakeWorker): BackgroundOpts['createWorker'] => () => worker as any;

test('operations-only edits refresh the tree, coalesce within the debounce, and detect same-size same-mtime edits', async t => {
  const cfg = fixture(t); writeOps(cfg.operations!, 'Before');
  const office = createOffice(cfg, { fullMs: 1000 });
  const start = office.live.lastFull;
  writeOps(cfg.operations!, 'Middle');
  await office.live.tick(start + 500); assert.equal(office.live.fulls, 0);
  writeOps(cfg.operations!, 'Newest');
  await office.live.tick(start + 1000);
  assert.equal(office.live.fulls, 1); assert.equal(office.data.operationTree!.nodes.find(n => n.id === 'work')!.title, 'Newest');
  const st = fs.statSync(cfg.operations!); fs.utimesSync(cfg.operations!, st.atime, new Date(100000));
  const sig = office.live.sig();
  writeOps(cfg.operations!, 'Latest'); fs.utimesSync(cfg.operations!, st.atime, new Date(100000));
  assert.notEqual(office.live.sig(), sig);
  await office.live.tick(office.live.lastFull + 1000);
  assert.equal(office.data.operationTree!.nodes.find(n => n.id === 'work')!.title, 'Latest');
  await office.live.tick(office.live.lastFull + 2000); assert.equal(office.live.fulls, 2);
});

test('hanging worker times out, retains snapshot, logs, releases collection and retries next tick', async t => {
  const cfg = fixture(t), worker = new FakeWorker(), errors: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => errors.push(args));
  let calls = 0;
  const office = createOffice(cfg, { collectAsync: () => ++calls === 1 ? collectBackground(cfg, { timeoutMs: 10, createWorker: factory(worker) }) : Promise.resolve({ ...office.data, collectedAt: 'retried' }) });
  const before = office.data;
  await office.live.full();
  assert.equal(worker.terminated, 1); assert.equal(office.data, before); assert.equal(errors.length, 1); assert.match(String(errors[0]), /timed out/);
  await office.live.tick(); assert.equal(calls, 2); assert.equal(office.data.collectedAt, 'retried');
});

for (const event of ['error', 'exit'] as const) test(`worker ${event} without message rejects promptly`, async t => {
  const cfg = fixture(t), worker = new FakeWorker();
  const pending = collectBackground(cfg, { timeoutMs: 1000, createWorker: factory(worker) });
  worker.emit(event, event === 'error' ? new Error('worker failed') : 0);
  await assert.rejects(pending, event === 'error' ? /worker failed/ : /exited 0 without a snapshot/);
  assert.equal(worker.terminated, 1);
});

test('pending notices drop oldest at 5000, count drops and log once on drain', async t => {
  const cfg = fixture(t); let finish!: (data: any) => void;
  const office = createOffice(cfg, { collectAsync: () => new Promise(resolve => { finish = resolve; }) });
  const warnings: unknown[][] = []; t.mock.method(console, 'warn', (...args: unknown[]) => warnings.push(args));
  const pending = office.live.full();
  for (let i = 0; i < 5003; i++) office.live.notice({ id: String(i) });
  assert.equal(office.live.droppedNotices, 3);
  const queue = (office.live as any).pendingNotices; assert.equal(queue.length, 5000); assert.equal(queue[0].id, '3'); assert.equal(queue.at(-1).id, '5002');
  const drained: string[] = []; t.mock.method(office.live, 'notice', (n: any) => drained.push(n.id));
  finish(office.data); await pending;
  assert.deepEqual(drained, Array.from({ length: 5000 }, (_, i) => String(i + 3))); assert.equal(warnings.length, 1); assert.match(String(warnings[0]), /dropped,3/);
});

test('archive excludes denied paths even with reader and writer events', t => {
  const office = createOffice(fixture(t)), denied = path.join(office.data.allow.roots.work, 'restricted/secret.md');
  office.data.artifacts.push({ path: denied, group: 'work', size: 1, mtime: '2026-01-01' });
  for (const verb of ['read', 'write']) office.data.events.push({ id: verb, verb, target: { kind: 'file', path: denied }, actor: { name: denied } } as any);
  const route = (office.app as any)._router.stack.find((s: any) => s.route?.path === '/api/archive').route;
  route.stack[0].handle({ query: {} }, { json: (output: unknown) => assert.ok(!JSON.stringify(output).includes(denied)) });
});
