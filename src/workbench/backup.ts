import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
// Backups are taken offline: preflight asks the live server to hold still, then the service is unloaded, copied and reloaded.
export interface ServiceControl { stop(): Promise<void>; start(): Promise<void> }
export interface Entry { path: string; size: number; sha256: string }
type Log = (line: string) => void;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export function launchdService(label: string, plist: string): ServiceControl {
  const target = `gui/${process.getuid!()}`;
  // bootout unloads the job, so KeepAlive cannot respawn it; never kill the process directly.
  return { async stop() { execFileSync('launchctl', ['bootout', `${target}/${label}`], { stdio: 'pipe' }); },
    async start() { execFileSync('launchctl', ['bootstrap', target, plist], { stdio: 'pipe' }); } };
}
export function processHolders(dir: string): number[] {
  try { return execFileSync('lsof', ['-t', '+D', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean).map(Number); }
  catch (e: any) { if (e.status === 1) return []; throw Error('Could not check which processes hold the data directory (lsof failed)'); }
}
export function manifest(root: string): Entry[] {
  const out: Entry[] = [];
  const walk = (dir: string) => { for (const name of fs.readdirSync(dir).sort()) { const full = path.join(dir, name), stat = fs.lstatSync(full);
    if (stat.isDirectory()) walk(full); else if (stat.isFile()) out.push({ path: path.relative(root, full), size: stat.size, sha256: createHash('sha256').update(fs.readFileSync(full)).digest('hex') });
    else throw Error(`Unexpected non-regular file in data directory: ${full}`); } };
  walk(root); return out;
}
export function compareManifests(expected: Entry[], actual: Entry[]) {
  const a = new Map(actual.map(e => [e.path, e])), problems: string[] = [];
  for (const e of expected) { const b = a.get(e.path); if (!b) problems.push(`missing ${e.path}`); else if (b.size !== e.size || b.sha256 !== e.sha256) problems.push(`differs ${e.path}`); a.delete(e.path); }
  for (const extra of a.keys()) problems.push(`unexpected ${extra}`);
  return problems;
}
function gitInfo(appDir: string) {
  try { return { revision: execFileSync('git', ['-C', appDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirty: !!execFileSync('git', ['-C', appDir, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim() }; }
  catch { return { revision: null, dirty: null }; }
}
async function api(base: string, url: string, body?: unknown, timeout = 3000) {
  const r = await fetch(base + url, { ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeout) });
  const value: any = await r.json(); if (!r.ok) throw Error(value.error || `HTTP ${r.status}`); return value;
}
const describe = (a: any) => [a.turns.length && `${a.turns.length} active turn(s)`, a.experiments.length && `${a.experiments.length} running experiment(s)`, a.candidates.length && `${a.candidates.length} alternative generation(s)`, a.shadow.length && `${a.shadow.length} pending shadow request(s)`].filter(Boolean).join(', ');
// An unreachable API is not proof that nothing is running.
export async function preflight(apiBase: string): Promise<{ ok: boolean; reason?: string }> {
  let activity: any;
  try { activity = await api(apiBase, '/api/admin/activity'); } catch (e: any) { return { ok: false, reason: `preflight failed: the API at ${apiBase} is unreachable (${e.message}). Use --offline-confirmed only if you know nothing is running.` }; }
  if (activity.busy) return { ok: false, reason: `preflight failed: work is active (${describe(activity)}). Wait for it to finish or stop it.` };
  try { activity = await api(apiBase, '/api/admin/quiesce', { on: true }); } catch (e: any) { return { ok: false, reason: `preflight failed: could not pause changes (${e.message})` }; }
  if (activity.busy) { await api(apiBase, '/api/admin/quiesce', { on: false }).catch(() => {}); return { ok: false, reason: `preflight failed: work started while pausing (${describe(activity)})` }; }
  return { ok: true };
}
export const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
export interface BackupOptions { dataDir: string; backupRoot: string; apiBase: string; service: ServiceControl; appDir: string; offlineConfirmed?: boolean;
  holders?: (dir: string) => number[]; copy?: (from: string, to: string) => void; log?: Log; waitMs?: number }
export async function backup(o: BackupOptions) {
  const log = o.log || (() => {}), holders = o.holders || processHolders;
  if (!fs.existsSync(o.dataDir)) return { ok: false, status: 'failed', reason: `Data directory not found: ${o.dataDir}` };
  if (!o.offlineConfirmed) { const check = await preflight(o.apiBase); if (!check.ok) return { ok: false, status: 'preflight failed', reason: check.reason }; log('Preflight passed; the server has paused changes.'); }
  else log('Preflight skipped (--offline-confirmed).');
  let stopped = false, dest: string | null = null;
  try {
    await o.service.stop(); stopped = true; log('Service unloaded.');
    const deadline = Date.now() + (o.waitMs ?? 15000);
    while (holders(o.dataDir).length) { if (Date.now() > deadline) throw Error('A process still holds the data directory after unloading the service'); await sleep(250); }
    fs.mkdirSync(o.backupRoot, { recursive: true, mode: 0o700 });
    dest = path.join(o.backupRoot, stamp()); fs.mkdirSync(dest, { mode: 0o700 });
    fs.writeFileSync(path.join(dest, 'INCOMPLETE'), 'This backup did not finish verification. Do not restore from it.\n', { mode: 0o600 });
    const source = manifest(o.dataDir), data = path.join(dest, 'data');
    (o.copy || ((from, to) => fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false })))(o.dataDir, data);
    for (const e of manifest(data)) fs.chmodSync(path.join(data, e.path), 0o600);
    const chmodDirs = (dir: string) => { fs.chmodSync(dir, 0o700); for (const n of fs.readdirSync(dir)) if (fs.lstatSync(path.join(dir, n)).isDirectory()) chmodDirs(path.join(dir, n)); };
    chmodDirs(dest);
    const problems = compareManifests(source, manifest(data));
    fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(source, null, 1), { mode: 0o600 });
    const git = gitInfo(o.appDir), meta = { format: 'room-backup-v1', createdAt: new Date().toISOString(), source: o.dataDir, appDir: o.appDir, gitRevision: git.revision, gitDirty: git.dirty,
      files: source.length, bytes: source.reduce((n, e) => n + e.size, 0), status: problems.length ? 'INCOMPLETE' : 'complete', ...(problems.length ? { problems: problems.slice(0, 50) } : {}) };
    fs.writeFileSync(path.join(dest, 'metadata.json'), JSON.stringify(meta, null, 1), { mode: 0o600 });
    if (problems.length) throw Error(`Copy does not match the manifest (${problems.length} problem(s), first: ${problems[0]})`);
    fs.rmSync(path.join(dest, 'INCOMPLETE'));
    log(`Copied and verified ${meta.files} files (${meta.bytes} bytes).`);
    return { ok: true, status: 'complete', dir: dest, files: meta.files, bytes: meta.bytes, gitRevision: git.revision, gitDirty: git.dirty };
  } catch (e: any) {
    if (dest && fs.existsSync(dest)) { const meta = path.join(dest, 'metadata.json'); if (!fs.existsSync(meta)) fs.writeFileSync(meta, JSON.stringify({ format: 'room-backup-v1', status: 'INCOMPLETE', error: e.message, at: new Date().toISOString() }, null, 1), { mode: 0o600 }); }
    return { ok: false, status: dest ? 'INCOMPLETE' : 'failed', dir: dest, reason: e.message };
  } finally {
    if (stopped) { try { await o.service.start(); log('Service reloaded.'); } catch (e: any) { log(`WARNING: could not reload the service: ${e.message}. Reload it manually.`); } }
    else if (!o.offlineConfirmed) await api(o.apiBase, '/api/admin/quiesce', { on: false }).catch(() => {});
  }
}
const freePort = () => new Promise<number>((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); }); s.on('error', reject); });
const spread = <T>(items: T[], n: number) => items.length <= n ? items : Array.from({ length: n }, (_, i) => items[Math.floor(i * (items.length - 1) / (n - 1 || 1))]);
export interface VerifyOptions { backup: string; repoDir: string; appDir?: string; sample?: number; log?: Log; keep?: boolean }
// Restores into a disposable directory and opens a sample read-only, with the app version that wrote the backup.
export async function verifyRestore(o: VerifyOptions) {
  const log = o.log || (() => {}), meta = JSON.parse(fs.readFileSync(path.join(o.backup, 'metadata.json'), 'utf8'));
  if (fs.existsSync(path.join(o.backup, 'INCOMPLETE')) || meta.status !== 'complete') return { ok: false, reason: 'This backup is marked INCOMPLETE.' };
  const expected: Entry[] = JSON.parse(fs.readFileSync(path.join(o.backup, 'manifest.json'), 'utf8'));
  const stored = compareManifests(expected, manifest(path.join(o.backup, 'data')));
  if (stored.length) return { ok: false, reason: `The backup copy no longer matches its manifest (${stored[0]})` };
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'room-restore-')), data = path.join(temp, 'data');
  let child: ReturnType<typeof spawn> | null = null, output = '';
  try {
    fs.cpSync(path.join(o.backup, 'data'), data, { recursive: true });
    let app = o.appDir;
    if (!app) {
      if (!meta.gitRevision) throw Error('The backup has no recorded app revision; pass an app directory explicitly.');
      app = path.join(temp, 'app'); fs.mkdirSync(app);
      execFileSync('sh', ['-c', 'git -C "$1" archive "$2" | tar -x -C "$3"', 'sh', o.repoDir, meta.gitRevision, app]);
      fs.symlinkSync(path.join(o.repoDir, 'node_modules'), path.join(app, 'node_modules'));
      if (meta.gitDirty) log('Note: the app had uncommitted changes when the backup was taken; verifying with the committed revision.');
    }
    if (!fs.readFileSync(path.join(app, 'src/workbench/generation.ts'), 'utf8').includes('ROOM_READONLY')) throw Error('The app version for this backup has no read-only mode, so opening it could write. Verify with a newer app directory.');
    const port = await freePort(), env: NodeJS.ProcessEnv = { ...process.env, ROOM_DATA_DIR: data, ROOM_PORT: String(port), ROOM_READONLY: '1' };
    for (const key of ['ROOM_DEMO', 'OPENGATEWAY_API_KEY', 'TOGETHER_API_KEY', 'TYPESAFE_API_KEY']) delete env[key];
    child = spawn(process.execPath, ['--import', 'tsx', 'src/workbench/server.ts'], { cwd: app, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout!.on('data', d => output += d); child.stderr!.on('data', d => output += d);
    const base = `http://127.0.0.1:${port}`;
    let boot: any = null;
    for (let i = 0; i < 80 && !boot; i++) { await sleep(250); boot = await api(base, '/api/bootstrap', undefined, 60000).catch(() => null); if (child.exitCode !== null) throw Error('Throwaway instance exited: ' + output.slice(-500)); }
    if (!boot) throw Error('Throwaway instance did not start: ' + output.slice(-500));
    if (!boot.readOnly) throw Error('Throwaway instance is not in read-only mode');
    const n = o.sample ?? 5, opened: string[] = [];
    for (const b of spread<any>(boot.branches, n)) { await api(base, `/api/branches/${b.id}`, undefined, 60000); await api(base, `/api/branches/${b.id}/changes`, undefined, 60000); opened.push(`room ${b.name}`); }
    for (const c of spread<any>(boot.comparisons, n)) { await api(base, `/api/comparisons/${c.id}`, undefined, 60000); opened.push(`comparison ${c.name}`); }
    for (const e of spread<any>(boot.experiments, n)) { await api(base, `/api/experiments/${e.id}`, undefined, 60000); opened.push(`experiment ${e.name}`); }
    child.kill('SIGTERM'); await new Promise(r => child!.exitCode !== null ? r(null) : child!.once('exit', r)); child = null;
    const writes = compareManifests(expected, manifest(data));
    if (writes.length) throw Error(`Opening the restored copy changed it (${writes.length} change(s), first: ${writes[0]})`);
    return { ok: true, opened, rooms: boot.branches.length, comparisons: boot.comparisons.length, experiments: boot.experiments.length, files: expected.length, restoredTo: o.keep ? temp : null };
  } catch (e: any) { return { ok: false, reason: e.message };
  } finally { if (child) child.kill('SIGTERM'); if (!o.keep) fs.rmSync(temp, { recursive: true, force: true }); }
}
