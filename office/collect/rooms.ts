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
  // arms named in restricted/key.json (trajectory values, or arm/condition/variant fields): masked by pattern in maskAll
  const arms = new Set<string>(); let key: any; try { key = JSON.parse(readWithin(allow, opDir, 'restricted/key.json')?.toString('utf8') || 'null'); } catch {}
  const visit = (v: any, k = '') => { if (typeof v === 'string') { const p = parseTraj(v); if (p) arms.add(p.arm); else if (/^(arm|condition|variant)$/i.test(k) && v.length <= 40) arms.add(v); } else if (v && typeof v === 'object') for (const [kk, x] of Object.entries(v)) visit(x, kk); };
  visit(key); for (const t of map.keys()) arms.add(parseTraj(t)!.arm);
  // a trajectory the masker never learned is masked anyway (fail closed): its arm is never shown
  const name = (t: string) => map.get(t) || (u.valid ? t : (() => { const p = parseTraj(t); return p ? `${p.phase}·${p.pair}·room ?` : maskText(t); })());
  return { masked: !u.valid, unmask: u, name, maskText, trajs: [...map.keys()], arms: [...arms] };
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
// The collector's own walk (index.ts): every depth, skipping dot directories and node_modules. The masker sees exactly the
// manifests the collector parses, so no trajectory it shows can be one the masker never learned (review P1-b).
export function walkFiles(root: string, pick: (p: string) => boolean, out: string[] = []) {
  let ns: string[] = []; try { ns = fs.readdirSync(root).sort(); } catch { return out; }
  for (const n of ns) { const p = path.join(root, n); let st: fs.Stats; try { st = fs.lstatSync(p); } catch { continue; }
    if (st.isDirectory() && n !== 'node_modules' && !n.startsWith('.')) walkFiles(p, pick, out); else if (st.isFile() && pick(p)) out.push(p); }
  return out;
}
export const isManifest = (p: string) => /\/manifest-[^/]+\.jsonl$/.test(p);
export function manifestsIn(opDir: string, _opId?: string) { return walkFiles(opDir, isManifest); }
// Every operation folder that needs a masker: any folder holding a manifest the collector parses (at any depth), and any
// coordination/<day>/<sub> or work/<thing> with a restricted/ directory.
let foldersMemo: { key: string; at: number; v: { dir: string; id: string }[] } | null = null;
export function opFolders(allow: Allowlist) {
  const key = allow.roots.coordination + '|' + allow.roots.work; if (foldersMemo && foldersMemo.key === key && Date.now() - foldersMemo.at < 2000) return foldersMemo.v;
  const v = opFoldersNow(allow); foldersMemo = { key, at: Date.now(), v }; return v;
}
function opFoldersNow(allow: Allowlist) {
  const out = new Map<string, { dir: string; id: string }>(), coord = allow.roots.coordination;
  for (const f of [...walkFiles(coord, isManifest), ...walkFiles(allow.roots.work, isManifest)]) {
    const o = opFolderOf(allow, f) || { dir: path.dirname(f), id: path.relative(coord, path.dirname(f)) }; out.set(o.dir, o); }
  const ls = (d: string) => { try { return fs.readdirSync(d); } catch { return []; } }, has = (d: string) => { try { return fs.statSync(path.join(d, 'restricted')).isDirectory(); } catch { return false; } };
  for (const d of ls(coord).filter(n => /^\d{4}-\d\d-\d\d$/.test(n))) for (const s of ls(path.join(coord, d))) { const dir = path.join(coord, d, s); if (has(dir)) out.set(dir, { dir, id: `${d}/${s}` }); }
  for (const t of ls(allow.roots.work)) { const dir = path.join(allow.roots.work, t); if (has(dir)) out.set(dir, { dir, id: 'work/' + t }); }
  return [...out.values()];
}
// One masker per operation folder, over every trajectory in its manifests (so letters agree across the floor, Expand
// and the fans); cached on the manifests' sizes, the restricted files and the current hashes of the locks it names.
const cache = new Map<string, { sig: string; m: ReturnType<typeof armMasker> }>();
export function maskerFor(allow: Allowlist, opDir: string, opId: string) {
  const names = manifestsIn(opDir, opId);
  const st = (p: string) => { try { const s = fs.statSync(p); return `${s.size}:${s.mtimeMs}`; } catch { return '-'; } };
  let locks = ''; try { const u = JSON.parse(fs.readFileSync(path.join(opDir, 'restricted/unmask.json'), 'utf8'));
    locks = [u?.labelsLock?.file, u?.responseLock?.file].map(f => { try { return typeof f === 'string' ? sha(fs.readFileSync(path.join(opDir, f))) : '-'; } catch { return '-'; } }).join(','); } catch {}
  const sig = [...names.map(n => n + ':' + st(n)), st(path.join(opDir, 'restricted/unmask.json')), st(path.join(opDir, 'restricted/key.json')), locks].join('|') + '|' + opId;
  const hit = cache.get(opDir); if (hit && hit.sig === sig) return hit.m;
  const trajs: string[] = []; for (const n of names) for (const m of fs.readFileSync(n, 'utf8').matchAll(/"traj":"([^"]+)"/g)) trajs.push(m[1]);
  const m = armMasker(allow, opDir, opId, trajs); cache.set(opDir, { sig, m }); return m;
}

// Every masked operation folder's masker: content anywhere (a Read of a manifest, a command's output, a packet quoting a
// trajectory) passes through all of them before it leaves the server. Defence in depth (review P1-a): while any operation is
// masked, any `x·vN·y` token, or one carrying an arm named in a masked folder's restricted/key.json, is masked by pattern,
// unless it is a trajectory id of an operation that has a valid unmask record.
export function maskAll(allow: Allowlist) {
  const all = opFolders(allow).map(o => maskerFor(allow, o.dir, o.id)), ms = all.filter(m => m.masked);
  if (!ms.length) return (text: string) => text;
  const keep = new Set(all.filter(m => !m.masked).flatMap(m => m.trajs)), arms = [...new Set(ms.flatMap(m => m.arms))].filter(a => a.length >= 2 && !/^v\d+$/.test(a)).map(a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`([\\w-]*)·(v\\d+${arms.length ? '|' + arms.join('|') : ''})(?![\\w-])((?:·[\\w-]*)?)`, 'g');
  return (text: string) => { let t = text; for (const m of ms) t = m.maskText(t); return t.replace(re, (full, a, _arm, c) => keep.has(full) ? full : `${a}·arm-masked${c}`); };
}
const maskDeepWith = (f: (s: string) => string) => { const go = (v: any, k = ''): any => typeof v === 'string' ? (k === 'path' || k === 'source' || k === 'file' ? v : f(v)) : Array.isArray(v) ? v.map(x => go(x, k)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([kk, x]) => [kk, go(x, kk)])) : v; return go; };
export const maskDeep = (allow: Allowlist) => maskDeepWith(maskAll(allow));

// ---- Blinding of room records (review High + P1-a) -------------------------------------------------------------------------
// While an operation is masked, nothing may let a room be traced to its arm: its .room-data records (turns, attempts, outcomes,
// revisions, branches), the branch → parent → checkpoint chain and its revisions (whose state.system is the arm template), and
// the operation's driver, checkpoint and template files are path-only everywhere (Expand, file route, shell output, Read
// results). The id set: every record id named in a masked folder's driver/checkpoint/template files and restricted/key.json,
// closed over the branch, revision and turn records those ids reach. A record that names any id in the set is masked too.
const ROOM_RECORD = /^(turns|attempts|outcomes|revisions|branches)$/i, UUIDS = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
export const isDriverFile = (p: string) => /^(manifest-.+\.jsonl|driver-state\.json|checkpoints?\.json)$|template|checkpoint/i.test(path.basename(p)) && !/\/restricted\//i.test(p);
let blindCache: { at: number; sig: string; root: string; files: Set<string>; ids: Set<string> } | null = null;
export function blindIndex(allow: Allowlist, now = Date.now()) {
  if (blindCache && now - blindCache.at < 1000 && blindCache.root === allow.roots.roomData + allow.roots.coordination) return blindCache; // checked at most once a second
  // recomputed when the masked set, a masked folder's driver files, or a room-record directory changes (new records)
  const mt = (p: string) => { try { const x = fs.statSync(p); return `${x.size}:${x.mtimeMs}`; } catch { return '-'; } };
  const masked = opFolders(allow).filter(o => maskerFor(allow, o.dir, o.id).masked);
  const sig = [...masked.map(o => o.dir + ':' + walkFiles(o.dir, isDriverFile).map(mt).join(',') + mt(path.join(o.dir, 'restricted/key.json'))).sort(), ...['branches', 'revisions', 'turns', 'attempts'].map(k => mt(path.join(allow.roots.roomData, k)))].join('|');
  if (blindCache && blindCache.sig === sig) { blindCache.at = now; return blindCache; }
  const files = new Set<string>(), ids = new Set<string>(), read = (p: string) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
  const addIds = (text: string) => { const got: string[] = []; for (const m of text.matchAll(UUIDS)) { const x = m[0].toLowerCase(); if (!ids.has(x)) { ids.add(x); got.push(x); } } return got; };
  const queue: string[] = [];
  for (const o of masked) {
    for (const f of walkFiles(o.dir, isDriverFile)) { files.add(f); queue.push(...addIds(read(f))); }
    queue.push(...addIds(read(path.join(o.dir, 'restricted/key.json'))));
  }
  for (let n = 0; n < queue.length && n < 200_000; n++) { const id = queue[n]; for (const k of ['branches', 'revisions', 'turns', 'attempts']) { const t = read(path.join(allow.roots.roomData, k, id + '.json')); if (t) queue.push(...addIds(t)); } }
  blindCache = { at: now, sig, root: allow.roots.roomData + allow.roots.coordination, files, ids }; return blindCache;
}
// The Allowlist hook (set by collect): true = path-only because it would reveal a masked operation's arms.
export function blindChecker(allow: Allowlist) {
  const seen = new Map<string, { m: number; b: boolean }>(), rd = () => allow.roots.roomData.toLowerCase() + path.sep;
  return (c: string) => {
    const ix = blindIndex(allow); if (!ix.files.size && !ix.ids.size) return false;
    if (ix.files.has(c)) return true;
    if (!c.toLowerCase().startsWith(rd())) return false;
    const rel = c.slice(rd().length).split(path.sep); if (rel.length !== 2 || !ROOM_RECORD.test(rel[0])) return false;
    if (ix.ids.has(rel[1].replace(/\.json$/i, '').toLowerCase())) return true;
    let m = 0; try { m = fs.statSync(c).mtimeMs; } catch { return false; }
    const hit = seen.get(c); if (hit && hit.m === m) return hit.b;
    let b = false; try { for (const x of fs.readFileSync(c, 'utf8').matchAll(UUIDS)) if (ix.ids.has(x[0].toLowerCase())) { b = true; break; } } catch {}
    seen.set(c, { m, b }); return b;
  };
}


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
