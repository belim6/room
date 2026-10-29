import { config, Allowlist } from './collect/privacy';
import { readRegistry, UUID } from './collect/roles';
import { blindChecker } from './collect/rooms';
import { appendBoard, pageBoard, roomOf, visibleMessage } from './board';
export function cli(command: string, argv: string[], env = process.env): { code: number; out: string } {
  try {
    const cfg = config(env);
    if (command === 'post') {
      const room = roomOf(argv[0]), text = argv[1], body: any = { text };
      for (let i = 2; i < argv.length; i += 2) { const key = argv[i] === '--link' ? 'link' : argv[i] === '--reply-to' ? 'replyTo' : ''; if (!key || !argv[i + 1] || key in body) throw new Error('Usage: office-post <room> "text" [--link path-or-node-id] [--reply-to id]; author flags are refused'); body[key] = argv[i + 1]; }
      const session = (env.CLAUDE_CODE_SESSION_ID || '').toLowerCase(), reg = readRegistry(cfg.sessions);
      if (reg.error || reg.skipped) throw new Error('Session registry invalid; register-session must repair registration');
      const entry = UUID.test(session) && reg.entries.filter(e => e.session === session && e.since <= new Date().toISOString()).at(-1);
      if (!entry) throw new Error('Unregistered session; run office/bin/register-session <role> from your session first');
      return { code: 0, out: appendBoard(cfg, room, body, { role: entry.role, kind: 'session' }).id };
    }
    if (argv[0] !== 'tail') throw new Error('Usage: office-board tail <room> [--lines 30] [--max-chars 3000]');
    const room = roomOf(argv[1]); let lines = 30, max = 3000, human = false;
    for (let i = 2; i < argv.length; i++) { const flag = argv[i]; if (flag === '--human') { human = true; continue; } const n = Number(argv[++i]); if (!Number.isInteger(n) || n < 1 || !['--lines', '--max-chars'].includes(flag)) throw new Error('Invalid tail option'); if (flag === '--lines') lines = n; else max = n; }
    if (max > 100000) throw new Error('max-chars must be at most 100000');
    if (room === 'leisure' && !(human && env.OFFICE_BOARD_ALLOW_LEISURE === '1')) throw new Error('Leisure tail refused: requires --human and OFFICE_BOARD_ALLOW_LEISURE=1');
    const allow = new Allowlist(cfg); allow.blind = blindChecker(allow);
    const out = pageBoard(cfg, room, undefined, lines).map(m => JSON.stringify(visibleMessage(m, allow))).join('\n');
    return { code: 0, out: out.slice(0, Math.max(0, max - 1)) };
  } catch (e: any) { return { code: 1, out: e.message || 'Board unavailable' }; }
}
if (require.main === module) { const r = cli(process.argv[2], process.argv.slice(3)); (r.code ? process.stderr : process.stdout).write(r.out + '\n'); process.exitCode = r.code; }
