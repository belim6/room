import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Allowlist } from './privacy';
import type { OfficeEvent } from './types';

// The unmask gate (spec 76 amendment P1, recheck P2). Arm names are shown only behind a VALID restricted/unmask.json:
//   {operation, at, by, labelsLock:{file, sha256}, responseLock?:{file, sha256}, keySha256}
// valid = the record sits in that operation's folder and names that operation; every lock path stays inside the folder
// (canonical, no symlink escape), exists, and hashes to the recorded value; keySha256 matches restricted/key.json; `at` is
// later than every lock's own `at`. Anything else, including no record at all, is masked.
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const ISO = (s: unknown) => typeof s === 'string' && Number.isFinite(Date.parse(s));
const HEX = /^[0-9a-f]{64}$/;
// Privileged read inside one folder: canonical path, must stay under `dir`, opened with the same open-then-verify rule.
function readWithin(allow: Allowlist, dir: string, rel: string): Buffer | null {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || rel.includes('\0')) return null;
  const root = allow.canonical(dir), c = allow.canonical(path.join(root, rel)), inside = (p: string) => p.toLowerCase().startsWith(root.toLowerCase() + path.sep);
  if (!inside(c)) return null;
  const o = allow.openVerified(c, inside); if (typeof o === 'string') return null;
  try { const b = Buffer.alloc(o.size); fs.readSync(o.fd, b, 0, o.size, 0); return b; } finally { fs.closeSync(o.fd); }
}
export interface Unmask { valid: boolean; reason: string; at?: string; keySha256?: string }
export function unmaskState(allow: Allowlist, opDir: string, opId: string): Unmask {
  const keyBuf = readWithin(allow, opDir, 'restricted/key.json'), keySha256 = keyBuf ? sha(keyBuf) : undefined;
  const raw = readWithin(allow, opDir, 'restricted/unmask.json'); if (!raw) return { valid: false, reason: 'no unmask record', keySha256 };
  let u: any; try { u = JSON.parse(raw.toString('utf8')); } catch { return { valid: false, reason: 'unmask record is not valid JSON', keySha256 }; }
  if (!u || typeof u !== 'object' || Array.isArray(u)) return { valid: false, reason: 'unmask record is not an object', keySha256 };
  if (u.operation !== opId) return { valid: false, reason: `unmask record names operation ${JSON.stringify(u.operation)}, not ${opId}`, keySha256 };
  if (!ISO(u.at) || typeof u.by !== 'string' || !u.by) return { valid: false, reason: 'unmask record lacks a valid at/by', keySha256 };
  if (!keyBuf || !HEX.test(String(u.keySha256)) || u.keySha256 !== keySha256) return { valid: false, reason: 'keySha256 does not match restricted/key.json', keySha256 };
  const locks = [['labelsLock', u.labelsLock, true], ['responseLock', u.responseLock, false]] as const;
  for (const [name, l, required] of locks) {
    if (l == null) { if (required) return { valid: false, reason: `${name} missing`, keySha256 }; continue; }
    if (typeof l !== 'object' || typeof l.file !== 'string' || !HEX.test(String(l.sha256))) return { valid: false, reason: `${name} malformed`, keySha256 };
    const b = readWithin(allow, opDir, l.file); if (!b) return { valid: false, reason: `${name} file missing or outside the operation folder`, keySha256 };
    if (sha(b) !== l.sha256) return { valid: false, reason: `${name} hash does not match the file`, keySha256 };
    let lock: any; try { lock = JSON.parse(b.toString('utf8')); } catch { return { valid: false, reason: `${name} file is not JSON`, keySha256 }; }
    if (!ISO(lock?.at) || !(Date.parse(u.at) > Date.parse(lock.at))) return { valid: false, reason: `unmask is not later than ${name}`, keySha256 };
  }
  return { valid: true, reason: 'valid unmask record', at: u.at, keySha256 };
}

// Trajectory ids look like `phase·arm·rNN`. Masked, the arm becomes a room letter whose order inside the pair comes from a
// hash salted with the key's hash, so it cannot be read back to the arm without the restricted key.
export const parseTraj = (t: string) => { const p = String(t).split('·'); return p.length === 3 ? { phase: p[0], arm: p[1], pair: p[2] } : null; };
export function armMasker(allow: Allowlist, opDir: string, opId: string, trajs: string[]) {
  const u = unmaskState(allow, opDir, opId), salt = u.keySha256 || 'no-key', map = new Map<string, string>();
  const byPair = new Map<string, string[]>();
  for (const t of new Set(trajs)) { const p = parseTraj(t); if (!p) continue; const k = `${p.phase}·${p.pair}`; (byPair.get(k) || byPair.set(k, []).get(k)!).push(t); }
  for (const [k, ts] of byPair) ts.map(t => ({ t, h: sha(salt + '|' + t) })).sort((a, b) => a.h.localeCompare(b.h)).forEach(({ t }, i) => map.set(t, u.valid ? t : `${k}·room ${String.fromCharCode(65 + i)}`));
  const maskText = (s: string) => { if (u.valid || !s) return s; let out = s; for (const [t, m] of map) out = out.split(t).join(m); return out; };
  return { masked: !u.valid, unmask: u, name: (t: string) => map.get(t) || (u.valid ? t : maskText(t)), maskText };
}

// The operation folder a path sits in: coordination/<day>/<sub> or (O4) work/<thing>. Unmask records and masking are per folder.
export function opFolderOf(allow: Allowlist, p: string): { dir: string; id: string } | null {
  const c = allow.canonical(p), isDir = (d: string) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } };
  const rc = path.relative(allow.roots.coordination, c).split(path.sep);
  if (rc.length >= 2 && /^\d{4}-\d\d-\d\d$/.test(rc[0]) && rc[1] && isDir(path.join(allow.roots.coordination, rc[0], rc[1]))) return { dir: path.join(allow.roots.coordination, rc[0], rc[1]), id: `${rc[0]}/${rc[1]}` };
  const rw = path.relative(allow.roots.work, c).split(path.sep);
  if (rw[0] && rw[0] !== '..' && !path.isAbsolute(rw[0]) && isDir(path.join(allow.roots.work, rw[0]))) return { dir: path.join(allow.roots.work, rw[0]), id: 'work/' + rw[0] };
  return null;
}
// Driver manifests of an operation folder: top level for coordination/<day>/<sub>, up to three levels down for work/<thing>.
export function manifestsIn(opDir: string, opId: string) {
  const out: string[] = [], walk = (d: string, depth: number) => { let ns: string[] = []; try { ns = fs.readdirSync(d).sort(); } catch { return; }
    for (const n of ns) { const p = path.join(d, n); let st: fs.Stats; try { st = fs.lstatSync(p); } catch { continue; }
      if (st.isFile() && /^manifest-[\w-]+\.jsonl$/.test(n)) out.push(p); else if (st.isDirectory() && depth > 0 && !n.startsWith('.') && n !== 'restricted') walk(p, depth - 1); } };
  walk(opDir, opId.startsWith('work/') ? 3 : 0); return out;
}
// One masker per operation folder, over every trajectory in its manifests (so letters agree across the floor, Expand
// and the fans); cached on the manifests' sizes and the restricted files' mtimes.
const cache = new Map<string, { sig: string; m: ReturnType<typeof armMasker> }>();
export function maskerFor(allow: Allowlist, opDir: string, opId: string) {
  const names = manifestsIn(opDir, opId);
  const st = (p: string) => { try { const s = fs.statSync(p); return `${s.size}:${s.mtimeMs}`; } catch { return '-'; } };
  const sig = [...names.map(n => n + ':' + st(n)), st(path.join(opDir, 'restricted/unmask.json')), st(path.join(opDir, 'restricted/key.json'))].join('|') + '|' + opId;
  const hit = cache.get(opDir); if (hit && hit.sig === sig) return hit.m;
  const trajs: string[] = []; for (const n of names) for (const m of fs.readFileSync(n, 'utf8').matchAll(/"traj":"([^"]+)"/g)) trajs.push(m[1]);
  const m = armMasker(allow, opDir, opId, trajs); cache.set(opDir, { sig, m }); return m;
}

// Every masked operation folder's masker: content anywhere (a Read of a manifest, a command's output, a packet quoting a
// trajectory) passes through all of them before it leaves the server.
export function maskAll(allow: Allowlist) {
  const ms: ReturnType<typeof armMasker>[] = [], root = allow.roots.coordination;
  let days: string[] = []; try { days = fs.readdirSync(root).filter(n => /^\d{4}-\d\d-\d\d$/.test(n)); } catch {}
  for (const d of days) { let subs: string[] = []; try { subs = fs.readdirSync(path.join(root, d)); } catch {}
    for (const s of subs) { const dir = path.join(root, d, s); try { if (!fs.statSync(dir).isDirectory() || !fs.readdirSync(dir).some(n => /^manifest-[\w-]+\.jsonl$/.test(n))) continue; } catch { continue; }
      const m = maskerFor(allow, dir, `${d}/${s}`); if (m.masked) ms.push(m); } }
  let things: string[] = []; try { things = fs.readdirSync(allow.roots.work); } catch {}
  for (const t of things) { const dir = path.join(allow.roots.work, t); try { if (!fs.statSync(dir).isDirectory()) continue; } catch { continue; }
    if (!manifestsIn(dir, 'work/' + t).length) continue; const m = maskerFor(allow, dir, 'work/' + t); if (m.masked) ms.push(m); }
  return (text: string) => { let t = text; for (const m of ms) t = m.maskText(t); return t; };
}
const maskDeepWith = (f: (s: string) => string) => { const go = (v: any, k = ''): any => typeof v === 'string' ? (k === 'path' || k === 'source' || k === 'file' ? v : f(v)) : Array.isArray(v) ? v.map(x => go(x, k)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([kk, x]) => [kk, go(x, kk)])) : v; return go; };
export const maskDeep = (allow: Allowlist) => maskDeepWith(maskAll(allow));

// Experiment fans: one lane per room of a driver run, matched pairs side by side, a tick per turn with the speaker's name.
export function fans(allow: Allowlist, events: OfficeEvent[], opDir: string, opId: string) {
  const files = manifestsIn(opDir, opId);
  const runs: any[] = [];
  for (const n of files) {
    const file = n, lines = fs.readFileSync(file, 'utf8').split('\n'), recs = lines.map((l, i) => { try { return { r: JSON.parse(l), i }; } catch { return null; } }).filter(Boolean) as { r: any; i: number }[];
    const M = maskerFor(allow, opDir, opId);
    const evByLine = new Map(events.filter(e => e.detailRef.file === file && e.detailRef.kind === 'manifest-turn').map(e => [e.detailRef.lines[0], e.id]));
    const speaker = new Map<string, string>(), lanes = new Map<string, any>(), stops = new Set<string>();
    for (const { r, i } of recs) {
      if (r.kind === 'intent') speaker.set(`${r.traj}|${r.turn}`, String(r.pick?.label || '?'));
      if (r.kind === 'done' && typeof r.traj === 'string') {
        const L = lanes.get(r.traj) || lanes.set(r.traj, { traj: r.traj, name: M.name(r.traj), ticks: [] }).get(r.traj);
        L.ticks.push({ turn: r.turn, ts: r.at, speaker: speaker.get(`${r.traj}|${r.turn}`) || '?', eventId: evByLine.get(i), fail: !!r.error });
      }
      if (r.kind === 'phase-end') { for (const k of Object.keys(r.stoppedPairs || {})) stops.add(k); for (const f of r.qualifyingFailures || []) stops.add(String(f?.pair || f?.traj || f)); }
    }
    const pairs = new Map<string, any[]>();
    for (const L of lanes.values()) { const p = parseTraj(L.traj), k = p ? `${p.phase}·${p.pair}` : L.traj; L.stopped = stops.has(k) || stops.has(L.traj); (pairs.get(k) || pairs.set(k, []).get(k)!).push(L); }
    runs.push({ manifest: path.basename(file), masked: M.masked, unmask: { valid: M.unmask.valid, reason: M.unmask.reason },
      pairs: [...pairs].sort((a, b) => a[0].localeCompare(b[0])).map(([pair, ls]) => ({ pair, lanes: ls.sort((a: any, b: any) => a.name.localeCompare(b.name)).map(({ traj, ...rest }: any) => (M.masked ? rest : { traj, ...rest })) })) });
  }
  return runs;
}
