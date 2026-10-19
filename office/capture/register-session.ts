// office/bin/register-session <role> [--note "…"]: the one writer of roles/sessions.json (O4). A Claude session runs it as its
// first step; it records this session's id (CLAUDE_CODE_SESSION_ID, which Claude Code sets in every tool's environment), the
// role, the time, and the session's messaging socket (so messages sent to that socket resolve to the role). Appends only: a
// role change is a new entry with its own `since`. Atomic (temp file + rename) under a lock directory. No network.
// Loaded under Node's own type stripping: erasable syntax only, explicit .ts imports.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../collect/privacy.ts';
import { ROLES, isRole, UUID } from '../collect/roles.ts';

export function register(argv: string[], env: NodeJS.ProcessEnv = process.env, now = new Date().toISOString()): { code: number; out: string } {
  const role = argv[0], ni = argv.indexOf('--note'), note = ni >= 0 ? String(argv[ni + 1] || '').slice(0, 200) : undefined;
  if (!isRole(role)) return { code: 2, out: `usage: register-session <role> [--note "…"]; role is one of: ${ROLES.join(', ')}` };
  const session = String(env.CLAUDE_CODE_SESSION_ID || '').toLowerCase();
  if (!UUID.test(session)) return { code: 2, out: 'register-session: CLAUDE_CODE_SESSION_ID is not set; run it from a Claude Code session (its Bash tool).' };
  const sock = String(env.CLAUDE_CODE_MESSAGING_SOCKET || ''), socket = /^\/[\w./-]{1,200}\.sock$/.test(sock) ? sock : undefined;
  const file = config(env).sessions!, lock = file + '.lock';
  if (!fs.existsSync(path.dirname(file))) return { code: 1, out: `register-session: ${path.dirname(file)} does not exist` };
  // lock: mkdir is atomic; a lock older than 10 s is left over from a crash and is taken over
  for (let i = 0; ; i++) {
    try { fs.mkdirSync(lock); break; } catch (e: any) {
      if (e?.code !== 'EEXIST') return { code: 1, out: `register-session: cannot lock ${lock}: ${e?.code}` };
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 10_000) { fs.rmdirSync(lock); continue; } } catch {}
      if (i > 100) return { code: 1, out: 'register-session: registry is locked by another registration' };
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try {
    let reg: { version: number; entries: any[] } = { version: 1, entries: [] };
    if (fs.existsSync(file)) {
      let raw: any; try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { code: 1, out: `register-session: ${file} is not valid JSON; not touching it` }; }
      if (!raw || raw.version !== 1 || !Array.isArray(raw.entries)) return { code: 1, out: `register-session: ${file} is not in the registry format ({version: 1, entries: [...]}); not touching it` };
      reg = raw;
    }
    const last = [...reg.entries].reverse().find(e => e?.session === session);
    if (last && last.role === role && (last.socket || undefined) === socket) return { code: 0, out: `already registered: session ${session.slice(0, 8)} is the ${role}` };
    reg.entries.push({ session, role, since: now, ...(socket ? { socket } : {}), ...(note ? { note } : {}), by: 'register-session' });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(reg, null, 1) + '\n', { mode: 0o644 }); fs.renameSync(tmp, file);
    return { code: 0, out: `registered: session ${session.slice(0, 8)} is the ${role}${last ? ` (was ${last.role})` : ''}` };
  } finally { try { fs.rmdirSync(lock); } catch {} }
}

if (/register-session\.ts$/.test(process.argv[1] || '')) { const r = register(process.argv.slice(2)); (r.code ? process.stderr : process.stdout).write(r.out + '\n'); process.exit(r.code); }
