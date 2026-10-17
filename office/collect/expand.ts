import fs from 'node:fs';
import path from 'node:path';
import type { Collected } from './index';
import type { OfficeEvent } from './types';
import { redact } from './privacy';
import { shellFacts, verifyCommand, offAllowlistWrites } from './shell';
import { codexSessions, execOf } from './codex';

// The content tier. Every text that leaves here is (a) from an allowlisted source file, (b) about an allowlisted target
// (or explicitly withheld with the path only), and (c) redacted. Summaries never call this.
export interface Section { title: string; text?: string; path?: string; allowed?: boolean; note?: string; truncated?: boolean }
const CAP = 120_000;
const clip = (s: string, cap = CAP): { text: string; truncated?: boolean } => s.length > cap ? { text: redact(s.slice(0, cap)), truncated: true } : { text: redact(s) };

// Source files are opened with the same open-then-verify rule as content reads.
function openSource(c: Collected, file: string) { const o = c.allow.openVerified(c.allow.canonical(file), p => c.allow.allowsSource(p)); return typeof o === 'string' ? null : o; }
export function lineAt(c: Collected, file: string, n: number): string {
  const offs = c.lineIndex.get(file); if (!offs || n < 0 || n >= offs.length) return '';
  const o = openSource(c, file); if (!o) return ''; try {
    const end = n + 1 < offs.length ? offs[n + 1] - 1 : o.size, buf = Buffer.alloc(Math.max(0, end - offs[n]));
    fs.readSync(o.fd, buf, 0, buf.length, offs[n]); return buf.toString('utf8');
  } finally { fs.closeSync(o.fd); }
}
const WITHHELD = 'output withheld (unverifiable)';
const verify = (c: Collected, cmd: string, cwd: string) => verifyCommand(cmd, cwd, c.allow.cfg.home, p => c.allow.allows(p), p => c.allow.allowsDir(p));
// The command text itself, unless it writes off-allowlist: then the payload is in the arguments and only the targets are shown.
const commandSection = (c: Collected, title: string, cmd: string, cwd: string): Section => {
  const w = offAllowlistWrites(cmd, cwd, c.allow.cfg.home, p => c.allow.allows(p));
  return w.withhold ? { title, allowed: false, note: `writes to ${w.targets.join(', ')} (content withheld)` } : { title, ...clip(cmd) };
};
const json = (s: string) => { try { return JSON.parse(s); } catch { return undefined; } };
const textOf = (c: any): string => typeof c === 'string' ? c : Array.isArray(c) ? c.map(b => b?.type === 'text' ? b.text : b?.type === 'image' ? '[image]' : '').join('\n') : '';
const fileLines = (c: Collected, file: string) => { const o = openSource(c, file); if (!o) return []; try { const b = Buffer.alloc(o.size); fs.readSync(o.fd, b, 0, o.size, 0); return b.toString('utf8').split('\n'); } finally { fs.closeSync(o.fd); } };

export function expandEvent(c: Collected, e: OfficeEvent): { id: string; source: { file: string; lines: number[] }; sections: Section[] } {
  const d = e.detailRef, out: Section[] = [], allow = c.allow, src = { file: d.file, lines: d.lines.map(n => n + 1) };
  if (!allow.allowsSource(d.file)) return { id: e.id, source: src, sections: [{ title: 'source', path: d.file, allowed: false, note: 'source file is outside the allowlist: path only' }] };
  const add = (title: string, s: string | undefined, extra: Partial<Section> = {}) => { if (s != null && s !== '') out.push({ title, ...clip(s), ...extra }); };
  const gate = (title: string, p: string, s: string | undefined) => { if (!allow.allows(p)) out.push({ title, path: p, allowed: false, note: 'off-allowlist: path only' }); else add(title, s, { path: p, allowed: true }); };
  const tgtPath = e.target?.kind === 'file' ? e.target.path! : undefined;
  switch (d.kind) {
    case 'claude-tool': {
      const rec = json(lineAt(c, d.file, d.lines[0])), use = rec?.message?.content?.find((b: any) => b.type === 'tool_use' && b.id === d.key), inp = use?.input || {};
      if (d.extra?.think != null) { const t = json(lineAt(c, d.file, d.extra.think as number)); add('thinking before this call', (t?.message?.content || []).filter((b: any) => b.type === 'thinking').map((b: any) => b.thinking).join('\n')); }
      const results = d.lines.slice(1).map(n => json(lineAt(c, d.file, n))).filter(Boolean);
      const result = results.map(r => Array.isArray(r.message?.content) ? r.message.content.filter((b: any) => b.type === 'tool_result' && b.tool_use_id === d.key).map((b: any) => textOf(b.content)).join('\n') : textOf(r.message?.content)).join('\n---\n');
      const name = use?.name;
      if (name === 'Read' || name === 'NotebookRead') { gate('file read (as the agent saw it)', tgtPath!, result); break; }
      if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(name)) {
        if (!tgtPath || !allow.allows(tgtPath)) { out.push({ title: 'written', path: tgtPath, allowed: false, note: `writes to ${tgtPath || 'an unknown path'} (content withheld)` }); break; }
        add('written', inp.content ?? (inp.old_string != null ? `--- old\n${inp.old_string}\n+++ new\n${inp.new_string}` : JSON.stringify(inp.edits || inp, null, 1)), { path: tgtPath, allowed: true }); add('result', result); break;
      }
      if (name === 'Bash') {
        const cmd = String(inp.command || ''), cwd = rec?.cwd || allow.cfg.home, v = verify(c, cmd, cwd);
        add('description', inp.description);
        out.push(commandSection(c, 'command', cmd, cwd));
        if (!v.ok) out.push({ title: 'output', allowed: false, note: `${WITHHELD}: ${v.reason}` }); else add('output', result);
        break;
      }
      if (name === 'Agent' || name === 'Task') { add('description', inp.description); add('prompt', inp.prompt); add('launch result', result.replace(/agentId: \S+.*$/gm, '')); if (e.target?.id.startsWith('agent:')) out.push(...actorContext(c, e.target.id, false)); break; }
      if (name === 'SendMessage') { add('message', inp.message ?? JSON.stringify(inp, null, 1)); add('result', result); break; }
      if (name === 'Grep' || name === 'Glob') {
        const where = String(inp.path || rec?.cwd || ''), pat = String(inp.glob || (name === 'Glob' ? inp.pattern : '') || '');
        add('input', JSON.stringify(inp, null, 1));
        const why = !where || !(allow.allows(where) || allow.allowsDir(where)) ? 'search root is off-allowlist: ' + where : /(^|\/)\.\.(\/|$)|^[/~]/.test(pat) ? 'pattern can leave the search root' : '';
        if (why) out.push({ title: 'result', allowed: false, note: `${WITHHELD}: ${why}` }); else add('result', result);
        break;
      }
      add('input', JSON.stringify(inp, null, 1)); out.push({ title: 'result', allowed: false, note: `${WITHHELD}: ${name} results are not checked against the allowlist` }); break;
    }
    case 'claude-text': { const r = json(lineAt(c, d.file, d.lines[0])); add('text', textOf(r?.message?.content)); break; }
    case 'claude-user': case 'claude-notification': { const r = json(lineAt(c, d.file, d.lines[0])); add('message', textOf(r?.message?.content)); break; }
    case 'claude-subagent-start': { const r = json(lineAt(c, d.file, 0)); add('prompt', textOf(r?.message?.content)); out.push(...actorContext(c, e.target!.id, false)); break; }
    case 'claude-subagent-end': out.push(...actorContext(c, e.actor.id)); break;
    case 'codex-session': case 'codex-exec': case 'codex-final': case 'codex-section': {
      const L = fileLines(c, d.file);
      if (d.kind === 'codex-session') {
        const s = codexSessions(L).sessions.find(x => x.start === d.lines[0]);
        if (s) { add('header', L.slice(s.start, (s.sections[0]?.start ?? s.start + 12)).join('\n')); const u = s.sections.find(x => x.kind === 'user'); if (u) add('prompt', L.slice(u.start + 1, u.end).join('\n')); }
        if (e.target?.kind === 'actor') out.push(...actorContext(c, e.target.id, false));
        break;
      }
      const body = L.slice(d.lines[0], d.lines[1]).join('\n');
      if (d.kind === 'codex-exec') {
        const x = execOf(L, { kind: 'exec', start: d.lines[0], end: d.lines[1] }), cwd = x.cwd || '/', v = x.wrapped ? verify(c, x.inner, cwd) : { ok: false, reason: 'command wrapper not understood' };
        const cs = commandSection(c, 'command (derived from log text)', x.inner, cwd); if (cs.text != null) cs.text = redact(x.raw + (x.cwd ? `\n  in ${x.cwd}` : ''));
        out.push(cs); add('status', x.status.trim());
        if (!v.ok) out.push({ title: 'output', allowed: false, note: `${WITHHELD}: ${v.reason}` }); else add('output (derived from log text)', x.output);
      } else add(d.kind === 'codex-final' ? 'final message (derived from log text)' : 'log section', body);
      if (d.kind === 'codex-final') out.push(...actorContext(c, e.actor.id, false));
      break;
    }
    case 'handoff': { add('events.jsonl line', lineAt(c, d.file, d.lines[0])); const ref = d.extra?.ref as string | undefined; if (ref) { const r = allow.read(ref); r.allowed ? add('ref', r.content, { path: r.path, allowed: true, note: r.missing ? 'missing' : 'current file content' }) : out.push({ title: 'ref', path: r.path, allowed: false, note: 'off-allowlist: path only' }); } break; }
    case 'manifest': add('manifest line', lineAt(c, d.file, d.lines[0])); break;
    case 'manifest-turn': {
      const r = json(lineAt(c, d.file, d.lines[0])); add('manifest line', JSON.stringify(r, null, 1));
      if (r?.outputRevision && /^[\w-]+$/.test(r.outputRevision)) {
        const f = path.join(allow.cfg.roomData, 'revisions', r.outputRevision + '.json'), rd = allow.read(f);
        if (!rd.allowed) out.push({ title: 'room message', path: rd.path, allowed: false, note: 'off-allowlist: path only' });
        else if (rd.content) { const rev = json(rd.content), msg = rev?.state?.messages?.find((m: any) => m.id === r.messageId);
          add('room message (.room-data revision, read directly)', msg ? `${msg.author || msg.speaker || msg.label || msg.name || ''}: ${msg.text ?? msg.content ?? JSON.stringify(msg)}` : 'message not found in revision', { path: rd.path, allowed: true }); }
        else out.push({ title: 'room message', path: rd.path, note: 'revision not found' });
      }
      break;
    }
    case 'driver-state': { const r = allow.read(d.file); add('driver-state.json', r.content); break; }
    case 'missing-label': gate('the transcript that has no label', d.file, allow.read(d.file).content); break;
    case 'gap': { const of = c.byId.get(String(d.extra?.of)); out.push({ title: 'gap', note: `${e.label}. Neither side is presumed complete.` }); if (of) out.push(...expandEvent(c, of).sections.map(s => ({ ...s, title: 'unmatched: ' + s.title }))); break; }
    default: add('raw line', d.lines.length ? lineAt(c, d.file, d.lines[0]) : '');
  }
  return { id: e.id, source: src, sections: out };
}

// Deep context for an ephemeral actor: prompt, every file it read (captured content when the source has it), its output.
export function actorContext(c: Collected, actorId: string, withPrompt = true): Section[] {
  const out: Section[] = [], evs = c.events.filter(e => e.actor.id === actorId);
  const spawn = c.events.find(e => e.verb === 'spawn' && e.target?.id === actorId);
  if (withPrompt && spawn) {
    const d = spawn.detailRef, r = json(lineAt(c, d.file, d.lines[0]));
    const t = d.kind === 'claude-subagent-start' ? textOf(r?.message?.content) : d.kind === 'claude-tool' ? r?.message?.content?.find((b: any) => b.type === 'tool_use' && b.id === d.key)?.input?.prompt
      : d.kind === 'codex-session' ? expandEvent(c, spawn).sections.find(s => s.title === 'prompt')?.text : undefined;
    if (t) out.push({ title: 'prompt', ...clip(t) });
  }
  const shown = new Set<string>();
  for (const e of evs.filter(e => e.verb === 'read' && e.target?.kind === 'file')) {
    const p = e.target!.path!;
    if (!c.allow.allows(p)) { out.push({ title: 'read', path: p, allowed: false, note: 'off-allowlist: path only' }); continue; }
    if (e.detailRef.kind === 'codex-exec') { // one command read several files: its output is shown once, not split by guesswork
      const k = e.detailRef.lines.join(',');
      if (!shown.has(k)) { shown.add(k); const secs = expandEvent(c, e).sections; out.push(...secs.filter(s => /^(command|output)/.test(s.title)).map(s => ({ ...s, title: s.title.startsWith('command') ? 'command' : s.title }))); }
      out.push({ title: 'read', path: p, allowed: true, note: 'content is in the command output above (derived)' }); continue;
    }
    const sec = expandEvent(c, e).sections.find(s => /file read|^output/.test(s.title));
    out.push({ title: 'read', path: p, allowed: sec?.allowed !== false, ...(sec?.text ? { text: sec.text, truncated: sec.truncated, note: e.provenance === 'captured' ? 'as the agent saw it' : 'command output (derived)' } : { note: sec?.note || 'no captured content' }) });
  }
  for (const e of evs.filter(e => e.verb === 'write' && e.target?.kind === 'file')) out.push(...expandEvent(c, e).sections.filter(s => s.title === 'written').map(s => ({ ...s, title: 'wrote' })));
  const end = evs.find(e => e.verb === 'end');
  if (end?.detailRef.kind === 'claude-subagent-end' && end.detailRef.lines.length) { const r = json(lineAt(c, end.detailRef.file, end.detailRef.lines[0])); const t = textOf(r?.message?.content); if (t) out.push({ title: 'final output', ...clip(t) }); }
  return out;
}
