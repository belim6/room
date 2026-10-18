// Spool records for live capture. Every record is built through O1's content rules (allowlist, withholding) and redacted
// before it is written; the collector redacts again when it reads. Loaded by the hook script and the Codex wrapper under
// Node's own type stripping, so: erasable syntax only, explicit .ts imports.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Allowlist, config, redact, redactDeep, type Config } from '../collect/privacy.ts';
import { shellFacts } from '../collect/shell.ts';
import { toolSections, commandSections, unwrapShell, clip, type Section } from '../collect/withhold.ts';

export const SPOOL_CAP = 16_000; // per text section in the spool; Expand on a spool event shows at most this much
const hash = (...p: unknown[]) => crypto.createHash('sha1').update(p.map(String).join('\u0000')).digest('hex').slice(0, 16);
const day = (ts: string) => ts.slice(0, 10);
const cap = (secs: Section[]): Section[] => secs.map(s => s.text && s.text.length > SPOOL_CAP ? { ...s, text: s.text.slice(0, SPOOL_CAP), truncated: true } : s);
export function spoolDir(cfg: Config = config()) { return cfg.spool || path.join(cfg.home, 'dev/room/office-spool'); }

export function append(dir: string, kind: 'hooks' | 'codex', recs: object[], ts = new Date().toISOString()) {
  if (!recs.length) return;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // one write() per batch of whole lines (O_APPEND): concurrent hooks never interleave inside a line
  const body = recs.map(r => JSON.stringify(redactDeep(r)) + '\n').join('');
  const fd = fs.openSync(path.join(dir, `${kind}-${day(ts)}.jsonl`), 'a', 0o600); try { fs.writeSync(fd, body); } finally { fs.closeSync(fd); }
}
// Failures never surface to the caller: one line, no content, in a counter file.
export function countError(dir: string, src: string, err: unknown) {
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.appendFileSync(path.join(dir, 'errors.count'), `${new Date().toISOString()}\t${src}\t${(err as any)?.code || (err as any)?.name || 'Error'}\n`, { mode: 0o600 }); } catch {}
}

// ---- Claude Code hooks ------------------------------------------------------------------------------------------
const FILE_TOOLS = new Set(['Read', 'NotebookRead', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
export function responseText(name: string, r: any): string {
  if (r == null) return '';
  if (typeof r === 'string') return r;
  if (name === 'Bash') return [r.stdout, r.stderr].filter(Boolean).join('\n');
  if (r.file && typeof r.file.content === 'string') return r.file.content;
  if (Array.isArray(r.content)) return r.content.map((b: any) => b?.type === 'text' ? b.text : '').join('\n');
  if (typeof r.content === 'string') return r.content;
  try { return JSON.stringify(r).slice(0, SPOOL_CAP); } catch { return ''; }
}
// At PostToolUse the output was produced in the PreToolUse cwd. ctx.preCwd: that cwd; null: no matching Pre record found.
// Shell/search output is then shown only if verified under the Pre cwd, and, when the two differ, both are allowlisted.
const CWD_TOOLS = new Set(['Bash', 'Grep', 'Glob']);
export function hookRecord(h: any, allow: Allowlist, now = new Date().toISOString(), ctx: { preCwd?: string | null } = {}) {
  const event = String(h?.hook_event_name || 'unknown'), session = String(h?.session_id || ''), cwd = typeof h?.cwd === 'string' ? h.cwd : allow.cfg.home;
  const base: any = { v: 1, src: 'hook', ts: now, event, session, ...(h?.agent_id ? { agent: String(h.agent_id) } : {}), ...(h?.agent_type ? { agentType: String(h.agent_type) } : {}), cwd: allow.canonical(cwd) };
  const name = h?.tool_name ? String(h.tool_name) : '', inp = h?.tool_input && typeof h.tool_input === 'object' ? h.tool_input : {};
  if (name) {
    base.tool = name; base.toolUseId = h.tool_use_id ? String(h.tool_use_id) : undefined;
    const target = FILE_TOOLS.has(name) && (inp.file_path || inp.notebook_path) ? allow.canonical(String(inp.file_path || inp.notebook_path), cwd) : undefined;
    if (target) base.target = target;
    if (name === 'Bash') { const f = shellFacts(String(inp.command || ''), cwd, allow.cfg.home); base.reads = f.reads; base.writes = f.writes; base.label = inp.description ? redact(String(inp.description)).slice(0, 200) : undefined; }
    if (name === 'Agent' || name === 'Task') { base.label = inp.description ? redact(String(inp.description)).slice(0, 200) : undefined; base.agentType = inp.subagent_type || base.agentType; }
    if (name === 'SendMessage') base.to = typeof inp.to === 'string' ? inp.to.slice(0, 80) : undefined;
    const result = event === 'PostToolUse' ? responseText(name, h.tool_response) : '';
    if (event === 'PostToolUse') {
      const s = typeof h.tool_response === 'string' ? h.tool_response : JSON.stringify(h.tool_response ?? '');
      const id = s.match(/agentId["':\s\\]+(a[0-9a-f]{8,})/); if (id && (name === 'Agent' || name === 'Task')) base.agentId = id[1];
      base.outcome = h.tool_response?.is_error || h.tool_response?.interrupted || /^Exit code [1-9]/.test(result) ? 'error' : 'ok';
    }
    let execCwd = cwd, hold = '';
    if (event === 'PostToolUse' && CWD_TOOLS.has(name)) {
      if (!ctx.preCwd) hold = 'no matching PreToolUse record (working directory unknown)';
      else if (allow.canonical(ctx.preCwd) !== allow.canonical(cwd) && !(allow.allowsDir(ctx.preCwd) && allow.allowsDir(cwd))) hold = 'working directory changed during the call and is not allowlisted on both sides';
      else execCwd = ctx.preCwd;
    }
    const secs = toolSections(allow, name, inp, hold ? '' : result, execCwd, target);
    if (hold) { const i = secs.findIndex(x => x.title === 'output' || x.title === 'result'); const w = { title: name === 'Bash' ? 'output' : 'result', allowed: false, note: `output withheld (unverifiable): ${hold}` }; if (i >= 0) secs[i] = w; else secs.push(w); }
    base.sections = cap(secs);
  } else if (event === 'UserPromptSubmit') base.sections = cap([{ title: 'message', ...clip(String(h?.prompt || '')) }]);
  else if (event === 'SubagentStop' && typeof h?.last_assistant_message === 'string') base.sections = cap([{ title: 'final output', prose: true, ...clip(h.last_assistant_message) }]);
  if (h?.agent_transcript_path) base.transcript = allow.canonical(String(h.agent_transcript_path));
  base.id = hash('hook', session, base.agent || '', event, base.toolUseId || '', now);
  return base;
}

// ---- Codex `exec --json` events ---------------------------------------------------------------------------------
// The run's working directory from argv: `-C DIR`, `-CDIR`, `--cd DIR`, `--cd=DIR`. More than one distinct value, a missing
// value, or a short-flag cluster that hides a C: undetermined, and then every command output of the run is withheld.
export function codexCwd(args: string[], base: string): { cwd: string | null; reason?: string } {
  const found: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') break;
    if (a === '-C' || a === '--cd') { if (i + 1 >= args.length) return { cwd: null, reason: `${a} without a directory` }; found.push(args[++i]); continue; }
    if (a.startsWith('--cd=')) { found.push(a.slice(5)); continue; }
    if (/^-C./.test(a)) { found.push(a.slice(2)); continue; }
    if (/^-[A-Za-z]+$/.test(a) && a.slice(1).includes('C')) return { cwd: null, reason: `ambiguous flag ${a}` };
    if (/^-[cmposi]$|^--(config|model|profile|output-schema|output-last-message|sandbox|image|color|enable|disable)$/.test(a)) i++; // flags that take a value: skip it
  }
  const dirs = [...new Set(found.map(d => path.resolve(base, d)))];
  if (dirs.length > 1) return { cwd: null, reason: 'working directory given more than once' };
  return { cwd: dirs[0] || path.resolve(base) };
}
export function codexItem(item: any, allow: Allowlist, cwd: string | null) {
  const t = String(item?.type || item?.item_type || 'unknown'), out: any = { type: t, id: item?.id ? String(item.id) : undefined, status: item?.status };
  if (t === 'command_execution') {
    const raw = Array.isArray(item.command) ? item.command.join(' ') : String(item.command || '');
    const arr = Array.isArray(item.command) && item.command.length === 3 && /(?:^|\/)(?:zsh|bash|sh)$/.test(item.command[0]) && /^-l?c$/.test(item.command[1]) ? { wrapped: true, inner: String(item.command[2]) } : unwrapShell(raw);
    const f = cwd ? shellFacts(arr.inner, cwd, allow.cfg.home) : { reads: [], writes: [] };
    out.reads = f.reads; out.writes = f.writes; out.exitCode = item.exit_code ?? undefined;
    out.sections = cap(commandSections(allow, arr.inner, cwd || '/', item.aggregated_output ?? item.output, { shown: raw, understood: arr.wrapped, withhold: cwd ? '' : 'the run\'s working directory could not be determined' }));
  } else if (t === 'file_change') out.paths = (item.changes || []).map((c: any) => ({ path: allow.canonical(String(c?.path || ''), cwd || '/'), kind: c?.kind }));
  else if (t === 'agent_message' || t === 'assistant_message') out.sections = cap([{ title: 'message', prose: true, ...clip(String(item.text ?? '')) }]);
  else if (t === 'reasoning') out.sections = cap([{ title: 'reasoning', prose: true, ...clip(String(item.text ?? '')) }]);
  else if (t === 'web_search') out.sections = cap([{ title: 'query', ...clip(String(item.query ?? '')) }]);
  else if (t === 'mcp_tool_call') { out.tool = `${item.server || '?'}/${item.tool || '?'}`; out.sections = [{ title: 'result', allowed: false, note: 'output withheld (unverifiable): MCP results are not checked against the allowlist' }]; }
  else if (t === 'todo_list') out.sections = cap([{ title: 'todo', ...clip((item.items || []).map((x: any) => `${x.completed ? '[x]' : '[ ]'} ${x.text}`).join('\n')) }]);
  else if (t === 'error') out.sections = cap([{ title: 'error', prose: true, ...clip(String(item.message ?? '')) }]);
  return out;
}
export function codexRecord(ev: any, run: string, seq: number, allow: Allowlist, cwd: string | null, meta: Record<string, unknown>, now = new Date().toISOString()) {
  const type = String(ev?.type || 'unknown'), r: any = { v: 1, src: 'codex', ts: now, run, seq, kind: 'event', type, ...meta };
  if (ev?.thread_id) r.thread = String(ev.thread_id);
  if (ev?.item) r.item = codexItem(ev.item, allow, cwd);
  if (ev?.usage) r.usage = { input: ev.usage.input_tokens, cached: ev.usage.cached_input_tokens, output: ev.usage.output_tokens };
  if (type === 'error' || type === 'turn.failed') r.sections = cap([{ title: 'error', prose: true, ...clip(String(ev?.message ?? ev?.error?.message ?? '')) }]);
  r.id = hash('codex', run, seq); return r;
}
export { Allowlist, config, clip };

// The PreToolUse record of a tool call, from the tail of today's and yesterday's hook spool (async hooks may land late:
// the caller retries a few times before treating the record as missing).
export function findPreCwd(dir: string, toolUseId: string, now = new Date()): string | null {
  const days = [now, new Date(now.getTime() - 864e5)].map(d => path.join(dir, `hooks-${d.toISOString().slice(0, 10)}.jsonl`)), needle = `"toolUseId":${JSON.stringify(toolUseId)}`;
  for (const f of days) {
    let fd: number; try { fd = fs.openSync(f, 'r'); } catch { continue; }
    try {
      const size = fs.fstatSync(fd).size, n = Math.min(size, 512 * 1024), buf = Buffer.alloc(n); fs.readSync(fd, buf, 0, n, size - n);
      const lines = buf.toString('utf8').split('\n');
      for (let i = lines.length - 1; i >= 0; i--) if (lines[i].includes(needle) && lines[i].includes('"event":"PreToolUse"')) { try { return JSON.parse(lines[i]).cwd || null; } catch {} }
    } finally { fs.closeSync(fd); }
  }
  return null;
}

// Terminal-generated signals (Ctrl-C, Ctrl-\) already reach codex: it shares the wrapper's process group. Forwarding them
// again would deliver them twice, so they are forwarded only when there is no terminal (a programmatic kill hits only us).
export const forwardSignal = (sig: string, interactive: boolean) => !(interactive && (sig === 'SIGINT' || sig === 'SIGQUIT'));
