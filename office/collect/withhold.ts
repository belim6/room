// O1's content rules as pure functions, shared by the Expand panel (read time) and the spool writers (write time), so a
// record can only reach the spool in the form Expand would show it. Plain erasable TypeScript with .ts imports: the hook
// script loads this under Node's own type stripping, without tsx.
import { redact, type Allowlist } from './privacy.ts';
import { verifyCommand, offAllowlistWrites } from './shell.ts';

// prose: agent-written text that cannot be checked against the allowlist (Deniz 2026-10-18): redacted, and served only on an
// explicit third click (/api/expand/event/:id/prose), never in summaries or a default Expand.
export interface Section { title: string; text?: string; path?: string; allowed?: boolean; note?: string; truncated?: boolean; prose?: boolean; hidden?: boolean }
export const PROSE_NOTE = 'unverified agent text: redacted, but not checked against the allowlist';
export const hideProse = (secs: Section[]): Section[] => secs.map(x => x.prose ? { title: x.title, prose: true, hidden: true, note: PROSE_NOTE, ...(x.truncated ? { truncated: true } : {}) } : x);
export const onlyProse = (secs: Section[]): Section[] => secs.filter(x => x.prose);
export const CAP = 120_000;
export const WITHHELD = 'output withheld (unverifiable)';
export const clip = (s: string, cap = CAP): { text: string; truncated?: boolean } => s.length > cap ? { text: redact(s.slice(0, cap)), truncated: true } : { text: redact(s) };
export const verify = (allow: Allowlist, cmd: string, cwd: string) => verifyCommand(cmd, cwd, allow.cfg.home, p => allow.allows(p), p => allow.allowsDir(p));
// The command text itself, unless it writes off-allowlist: then the payload is in the arguments and only the targets are shown.
export function commandSection(allow: Allowlist, title: string, cmd: string, cwd: string, shown = cmd): Section {
  const w = offAllowlistWrites(cmd, cwd, allow.cfg.home, p => allow.allows(p));
  return w.withhold ? { title, allowed: false, note: `writes to ${w.targets.join(', ')} (content withheld)` } : { title, ...clip(shown) };
}
// `/bin/zsh -lc '…'` / `bash -lc "…"` as Codex runs commands; anything else is not understood (and so unverifiable).
export function unwrapShell(raw: string): { wrapped: boolean; inner: string } {
  const w = raw.match(/^\S*(?:zsh|bash|sh) -l?c '([\s\S]*)'$/) || raw.match(/^\S*(?:zsh|bash|sh) -l?c "([\s\S]*)"$/);
  return w ? { wrapped: true, inner: w[1].replace(/'\\''/g, "'") } : { wrapped: false, inner: raw };
}
// A shell command (Claude Bash or a Codex exec) and its output, under the fail-closed rule.
export function commandSections(allow: Allowlist, cmd: string, cwd: string, output: string | undefined, { title = 'command', outTitle = 'output', shown = cmd, understood = true, withhold = '' } = {}): Section[] {
  const out: Section[] = [commandSection(allow, title, cmd, cwd, shown)], v = withhold ? { ok: false, reason: withhold } : understood ? verify(allow, cmd, cwd) : { ok: false, reason: 'command wrapper not understood' };
  if (!v.ok) out.push({ title: 'output', allowed: false, note: `${WITHHELD}: ${v.reason}` });
  else if (output) out.push({ title: outTitle, ...clip(output) });
  return out;
}
// One Claude Code tool call (input + result text) as Expand shows it. Agent context and thinking are added by the caller.
export function toolSections(allow: Allowlist, name: string, inp: any, result: string, cwd: string, target?: string): Section[] {
  const out: Section[] = [], add = (title: string, s: unknown, extra: Partial<Section> = {}) => { if (s != null && s !== '') out.push({ title, ...clip(String(s)), ...extra }); };
  if (name === 'Read' || name === 'NotebookRead') {
    if (!target || !allow.allows(target)) out.push({ title: 'file read (as the agent saw it)', path: target, allowed: false, note: 'off-allowlist: path only' });
    else add('file read (as the agent saw it)', result, { path: target, allowed: true });
    return out;
  }
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(name)) {
    if (!target || !allow.allows(target)) return [{ title: 'written', path: target, allowed: false, note: `writes to ${target || 'an unknown path'} (content withheld)` }];
    add('written', inp.content ?? (inp.old_string != null ? `--- old\n${inp.old_string}\n+++ new\n${inp.new_string}` : JSON.stringify(inp.edits || inp, null, 1)), { path: target, allowed: true }); add('result', result); return out;
  }
  if (name === 'Bash') { add('description', inp.description, { prose: true }); out.push(...commandSections(allow, String(inp.command || ''), cwd, result)); return out; }
  if (name === 'Agent' || name === 'Task') { add('description', inp.description); add('prompt', inp.prompt); add('launch result', String(result || '').replace(/agentId: \S+.*$/gm, ''), { prose: true }); /* a synchronous agent returns its prose here */ return out; }
  if (name === 'SendMessage') { add('message', inp.message ?? JSON.stringify(inp, null, 1)); add('result', result); return out; }
  if (name === 'Grep' || name === 'Glob') {
    const where = String(inp.path || cwd || ''), pat = String(inp.glob || (name === 'Glob' ? inp.pattern : '') || '');
    add('input', JSON.stringify(inp, null, 1));
    const why = !where || !(allow.allows(where) || allow.allowsDir(where)) ? 'search root is off-allowlist: ' + where : /(^|\/)\.\.(\/|$)|^[/~]/.test(pat) ? 'pattern can leave the search root' : '';
    if (why) out.push({ title: 'result', allowed: false, note: `${WITHHELD}: ${why}` }); else add('result', result);
    return out;
  }
  add('input', JSON.stringify(inp, null, 1)); out.push({ title: 'result', allowed: false, note: `${WITHHELD}: ${name} results are not checked against the allowlist` }); return out;
}
