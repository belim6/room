// Claude Code observation hook, loaded by hook.mjs: stdin JSON -> one sanitized spool line. Never prints, never blocks
// the tool (configure as async); failures go to the spool's errors.count. No network.
import fs from 'node:fs';
import { hookRecord, findPreCwd, append, countError, spoolDir, Allowlist, config } from './sanitize.ts';

const CWD_TOOLS = new Set(['Bash', 'Grep', 'Glob']);
export async function run(input = fs.readFileSync(0, 'utf8')) {
  const cfg = config(), dir = spoolDir(cfg);
  try {
    const h = JSON.parse(input || '{}'), ctx: { preCwd?: string | null } = {};
    if (h?.hook_event_name === 'PostToolUse' && CWD_TOOLS.has(h?.tool_name) && h?.tool_use_id) {
      // the Pre hook runs async too and may still be writing: look a few times before treating it as missing
      for (let i = 0; i < 6 && !ctx.preCwd; i++) { ctx.preCwd = findPreCwd(dir, String(h.tool_use_id)); if (!ctx.preCwd && i < 5) await new Promise(r => setTimeout(r, 100)); }
    }
    const rec = hookRecord(h, new Allowlist(cfg), new Date().toISOString(), ctx);
    append(dir, 'hooks', [rec], rec.ts);
  } catch (e) { countError(dir, 'hook', e); }
}
