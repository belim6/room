import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface Config { coordination: string; promptKnowledge: string; roomData: string; claudeProject: string; coordinatorSession?: string; home: string; spool?: string; repos?: string[];
  room?: string; work?: string; research?: string; sessions?: string; extra?: string[] }
export function config(env: NodeJS.ProcessEnv = process.env): Config {
  const home = env.OFFICE_HOME || os.homedir(), room = env.OFFICE_ROOM || path.join(home, 'dev/room');
  // coordination/ moves to archive/coordination/ in phase 2 of the file reorganisation: whichever exists is read as history
  const coordination = env.OFFICE_COORDINATION || [path.join(room, 'coordination'), path.join(room, 'archive/coordination')].find(p => fs.existsSync(p)) || path.join(room, 'coordination');
  return {
    home, coordination, room,
    work: env.OFFICE_WORK || path.join(room, 'work'), research: env.OFFICE_RESEARCH || path.join(room, 'research'),
    sessions: env.OFFICE_SESSIONS || path.join(room, 'roles/sessions.json'),
    // top-level homes of what used to live in coordination/ (A2-A4): critic logs, the handoff log, briefings
    extra: env.OFFICE_EXTRA != null ? env.OFFICE_EXTRA.split(':').filter(Boolean) : ['critic', 'briefing'].map(n => path.join(room, n)),
    promptKnowledge: env.OFFICE_PROMPT_KNOWLEDGE || path.join(room, 'prompt-knowledge'),
    roomData: env.OFFICE_ROOM_DATA || path.join(room, '.room-data'),
    claudeProject: env.OFFICE_CLAUDE_PROJECT || path.join(home, '.claude/projects', room.replace(/[/.]/g, '-')),
    coordinatorSession: env.OFFICE_COORDINATOR_SESSION || undefined,
    spool: env.OFFICE_SPOOL || path.join(room, 'office-spool'),
    // Deniz 2026-10-18: the repo is on the allowlist (room, room-stable and the room-* worktrees: the same code).
    repos: env.OFFICE_REPOS != null ? env.OFFICE_REPOS.split(':').filter(Boolean) : [room, ...siblings(path.dirname(room), path.basename(room))],
  };
}

export const expandHome = (p: string, home: string) => p === '~' ? home : p.startsWith('~/') ? path.join(home, p.slice(2)) : p;
// Canonical path: realpath of the deepest existing ancestor plus the remainder, so a symlink anywhere in the chain is resolved
// and a not-yet-existing tail cannot smuggle `..` (path.resolve has already normalized it lexically).
export function canonical(p: string, home: string, cwd = '/') {
  const abs = path.resolve(cwd, expandHome(p, home)); const rest: string[] = []; let cur = abs;
  for (;;) {
    try { return path.join(fs.realpathSync.native(cur), ...rest.reverse()); } // .native: the on-disk case, not the requested one
    catch { const up = path.dirname(cur); if (up === cur) return abs; rest.push(path.basename(cur)); cur = up; }
  }
}
const real = (p: string) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
// macOS volumes are case-insensitive: every root/exclusion comparison ignores case as well (belt and braces with .native).
const under = (p: string, root: string) => { const a = p.toLowerCase(), b = root.toLowerCase(); return a === b || a.startsWith(b + path.sep); };
const relSegs = (root: string, c: string) => path.relative(root.toLowerCase(), c.toLowerCase()).split(path.sep);
export const ROOM_KINDS = /^(revisions|turns|attempts|outcomes|branches|vault-[a-z-]+|experiment[a-z-]*)$/i;

export interface Opened { fd: number; size: number }
// git worktrees of the repo only (a worktree has a .git *file*): room-backups and other look-alikes are not code
const siblings = (dir: string, name: string) => { try { return fs.readdirSync(dir).filter(n => n.startsWith(name + '-')).map(n => path.join(dir, n)).filter(p => { try { return fs.statSync(path.join(p, '.git')).isFile(); } catch { return false; } }); } catch { return []; } };
// Inside the repos, these stay path-only wherever they occur (.room-data is handled by its own record-kind rule).
export const EXCLUDED_SEGMENT = /^(saves|saved|oldsaves|prompt-archive|_dead|node_modules|\.git|office-spool|\.room-data)$/i;
export class Allowlist {
  roots: { coordination: string; promptKnowledge: string; roomData: string; claudeProject: string; spool: string; repos: string[]; work: string; research: string };
  cfg: Config;
  // Test seam: runs between the allowlist check and the open, so a symlink swap there can be simulated.
  beforeOpen?: (canonicalPath: string) => void;
  constructor(cfg: Config) {
    this.cfg = cfg;
    this.roots = { coordination: real(cfg.coordination), promptKnowledge: real(cfg.promptKnowledge), roomData: real(cfg.roomData), claudeProject: real(cfg.claudeProject), spool: real(cfg.spool || path.join(cfg.home, 'dev/room/office-spool')), repos: (cfg.repos || []).map(real),
      work: real(cfg.work || path.join(cfg.home, 'dev/room/work')), research: real(cfg.research || path.join(cfg.home, 'dev/room/research')) };
  }
  canonical(p: string, cwd?: string) { return canonical(p, this.cfg.home, cwd); }
  // Raw sources whose text embeds other files' contents (transcripts, Codex/driver logs): readable by the collector and the
  // per-event expander only, never served whole.
  isTranscript(p: string, cwd?: string) {
    const c = this.canonical(p, cwd), r = this.roots; if (!under(c, r.claudeProject)) return false;
    const rel = relSegs(r.claudeProject, c), last = rel[rel.length - 1];
    return (rel.length === 1 && /^[0-9a-f-]{36}\.jsonl$/i.test(last)) || (rel.length >= 3 && rel[1] === 'subagents' && /^agent-[A-Za-z0-9_-]+\.jsonl$/i.test(last));
  }
  isRawLog(p: string, cwd?: string) { const c = this.canonical(p, cwd); return under(c, this.roots.coordination) && /\.log$/i.test(c); }
  // The Office's own spool: already filtered at write, read only per event (path-only on the file route).
  isSpool(p: string, cwd?: string) { const c = this.canonical(p, cwd); return under(c, this.roots.spool) && /\.jsonl$/i.test(c); }
  allowsSource(p: string, cwd?: string) { return this.isTranscript(p, cwd) || this.allows(p, cwd) || this.isRawLog(p, cwd) || this.isSpool(p, cwd); }
  // Content tier: may this path's own content be shown? Transcripts and raw logs: no (path only).
  allows(p: string, cwd?: string) {
    if (!p || p.includes('\0')) return false;
    const c = this.canonical(p, cwd), r = this.roots;
    if (/\.log$/i.test(c) || under(c, r.spool) || /^\.env/i.test(path.basename(c))) return false; // .env* anywhere: path only
    if (under(c, r.roomData)) { const rel = relSegs(r.roomData, c); return rel.length === 2 && ROOM_KINDS.test(rel[0]) && rel[1].endsWith('.json'); }
    // restricted/ (keys, unmask records, read sides) is never served: the Office validates it internally (rooms.ts)
    if (/(^|\/)restricted(\/|$)/i.test(c)) return false;
    if (under(c, r.coordination) || under(c, r.promptKnowledge)) return true;
    for (const root of [r.work, r.research]) if (under(c, root)) return !relSegs(root, c).some(seg => EXCLUDED_SEGMENT.test(seg) || /^\.env/i.test(seg));
    return this.inRepo(c);
  }
  private inRepo(c: string) {
    for (const root of this.roots.repos) if (under(c, root)) return !relSegs(root, c).some(seg => EXCLUDED_SEGMENT.test(seg) || /^\.env/i.test(seg));
    return false;
  }
  // A directory a shell command may run in (or list) without escaping the content tier.
  allowsDir(p: string, cwd?: string) { const c = this.canonical(p, cwd), r = this.roots; return !under(c, r.roomData) && !under(c, r.spool) && (under(c, r.coordination) || under(c, r.promptKnowledge) || under(c, r.work) || under(c, r.research) || this.inRepo(c)); }
  // Which permanent artifact node a path belongs to (metadata only; works for off-allowlist paths too).
  group(p: string, cwd?: string) {
    const c = this.canonical(p, cwd), r = this.roots;
    if (under(c, r.coordination)) return 'archive';
    if (under(c, r.promptKnowledge)) return 'ledger';
    if (under(c, r.roomData)) return /^vault-/i.test(relSegs(r.roomData, c)[0]) ? 'vault' : 'rooms';
    if (under(c, r.claudeProject)) return 'transcripts';
    if (under(c, r.work) || under(c, r.research)) return 'work';
    if (under(c, path.dirname(r.coordination)) && !/\/\.(env|git)/i.test(c)) return 'repo';
    return 'outside';
  }
  // Open-then-verify (no TOCTOU): open without following a final symlink, then require that the path still resolves to
  // itself and that the descriptor is the same inode as that path. Any mismatch: refuse.
  openVerified(c: string, ok: (p: string) => boolean): Opened | 'refused' | 'missing' {
    this.beforeOpen?.(c);
    let fd: number; try { fd = fs.openSync(c, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)); } catch (e: any) { return e?.code === 'ENOENT' ? 'missing' : 'refused'; }
    try {
      const fst = fs.fstatSync(fd); let rp: string, st: fs.Stats;
      try { rp = fs.realpathSync.native(c); st = fs.statSync(rp); } catch { fs.closeSync(fd); return 'refused'; }
      if (rp !== c || !ok(rp) || st.dev !== fst.dev || st.ino !== fst.ino || !fst.isFile()) { fs.closeSync(fd); return 'refused'; }
      return { fd, size: fst.size };
    } catch { fs.closeSync(fd); return 'refused'; }
  }
  read(p: string, cwd?: string, max = 400_000): { path: string; allowed: boolean; content?: string; truncated?: boolean; missing?: boolean; note?: string } {
    const c = this.canonical(p, cwd);
    if (!this.allows(c)) return { path: c, allowed: false, ...(this.isTranscript(c) || this.isRawLog(c) || this.isSpool(c) ? { note: 'raw transcript/log: content only through per-event Expand' } : {}) };
    const o = this.openVerified(c, x => this.allows(x));
    if (o === 'missing') return { path: c, allowed: true, missing: true };
    if (o === 'refused') return { path: c, allowed: false, note: 'refused: path changed between check and open' };
    try { const buf = Buffer.alloc(Math.min(o.size, max)); fs.readSync(o.fd, buf, 0, buf.length, 0); return { path: c, allowed: true, content: redact(buf.toString('utf8')), ...(o.size > max ? { truncated: true } : {}) }; }
    finally { fs.closeSync(o.fd); }
  }
}

const OWN = new Set(['osmanabuziddin@gmail.com', 'deniz@xlcloud.com']);
const R = (kind: string) => `[redacted: ${kind}]`;
// Order matters: specific shapes first, then assignments, then generic secret-adjacent values, then emails.
// Key-prefix shapes: safe to apply anywhere, including paths and ids.
const PREFIX: [RegExp, (m: string, ...g: string[]) => string][] = [
  [/\bsk-ant-[A-Za-z0-9_-]{8,}/g, () => R('anthropic-key')],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}/g, () => R('api-key')],
  [/\btgp_v1_[A-Za-z0-9_-]{10,}/g, () => R('together-key')],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/g, () => R('github-token')],
  [/\bAKIA[0-9A-Z]{16}\b/g, () => R('aws-key')],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, () => R('jwt')],
];
const Q = String.raw`\\?["']?`; // optional (escaped) quote around JSON keys/values
const RULES: [RegExp, (m: string, ...g: string[]) => string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, () => R('private-key')],
  ...PREFIX,
  [new RegExp(String.raw`\b(authorization|proxy-authorization)(${Q}\s*[:=]\s*${Q})(?:(bearer|basic|token)\s+)?(?!\[redacted)[^\s"',;}\\]+`, 'gi'), (_m, h, sep) => `${h}${sep}${R('authorization')}`],
  [/\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, () => `Bearer ${R('bearer')}`],
  [new RegExp(String.raw`\b([A-Za-z0-9_]*_API_KEY|[A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|_PASS|_KEY))(${Q}\s*[:=]\s*${Q})(?!\[redacted)[^\s"'\x60;&|\\,}]+`, 'g'), (_m, k, sep) => `${k}${sep}${R('key-assignment')}`],
  [/^(\s*(?:export\s+)?)([A-Z][A-Z0-9_]+)=(?!\[redacted)\S.*$/gm, (_m, pre, k) => `${pre}${k}=${R('env-value')}`],
  [/\\n((?:\\t| )*(?:export\s+)?)([A-Z][A-Z0-9_]+)=(?!\[redacted)(?:(?!\\n)[^"\n])+/g, (_m, pre, k) => `\\n${pre}${k}=${R('env-value')}`],
  [new RegExp(String.raw`\b(key|token|secret|password|passwd|apikey|api_key|access_key|private_key)\b(${Q}\s*[:=]?\s*${Q})([A-Za-z0-9+/_-]{20,}={0,2})`, 'gi'), (_m, k, sep) => `${k}${sep}${R('secret')}`],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) => OWN.has(m.toLowerCase()) ? m : R('email')],
];
export function redact(s: string): string { if (!s) return s; for (const [re, f] of RULES) s = s.replace(re, f as any); return s; }
export function redactPath(s: string): string { if (!s) return s; for (const [re, f] of PREFIX) s = s.replace(re, f as any); return s; }
// Path-like fields get only the key-prefix rules, so the generic secret rule can't mangle a path or id.
const PATHISH = new Set(['path', 'id', 'source', 'file', 'ref', 'agentFile', 'launch', 'of', 'parent', 'target', 'transcript', 'cwd', 'reads', 'writes', 'session', 'run', 'thread', 'toolUseId', 'agent', 'agentId']);
export const redactDeep = <T>(v: T, key = ''): T => typeof v === 'string' ? (PATHISH.has(key) ? redactPath(v) : redact(v)) as any : Array.isArray(v) ? v.map(x => redactDeep(x, key)) as any :
  v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactDeep(x, k)])) as any : v;
