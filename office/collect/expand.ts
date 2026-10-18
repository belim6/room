import fs from 'node:fs';
import path from 'node:path';
import type { Collected } from './index';
import type { OfficeEvent } from './types';
import { codexSessions, execOf } from './codex';
import { clip, toolSections, commandSections, type Section } from './withhold';
export type { Section };

// The content tier. Every text that leaves here is (a) from an allowlisted source file, (b) about an allowlisted target
// (or explicitly withheld with the path only), and (c) redacted. Summaries never call this.
// Source files are opened with the same open-then-verify rule as content reads.
function openSource(c: Collected, file: string) { const o = c.allow.openVerified(c.allow.canonical(file), p => c.allow.allowsSource(p)); return typeof o === 'string' ? null : o; }
export function lineAt(c: Collected, file: string, n: number): string {
  const offs = c.lineIndex.get(file); if (!offs || n < 0 || n >= offs.length) return '';
  const o = openSource(c, file); if (!o) return ''; try {
    const end = n + 1 < offs.length ? offs[n + 1] - 1 : o.size, buf = Buffer.alloc(Math.max(0, end - offs[n]));
    fs.readSync(o.fd, buf, 0, buf.length, offs[n]); return buf.toString('utf8');
  } finally { fs.closeSync(o.fd); }
}
const json = (s: string) => { try { return JSON.parse(s); } catch { return undefined; } };
const textOf = (c: any): string => typeof c === 'string' ? c : Array.isArray(c) ? c.map(b => b?.type === 'text' ? b.text : b?.type === 'image' ? '[image]' : '').join('\n') : '';
const fileLines = (c: Collected, file: string) => { const o = openSource(c, file); if (!o) return []; try { const b = Buffer.alloc(o.size); fs.readSync(o.fd, b, 0, o.size, 0); return b.toString('utf8').split('\n'); } finally { fs.closeSync(o.fd); } };

export function expandEvent(c: Collected, e: OfficeEvent): { id: string; source: { file: string; lines: number[] }; sections: Section[] } {
  const d = e.detailRef, out: Section[] = [], allow = c.allow, src = { file: d.file, lines: d.lines.map(n => n + 1) };
  if (d.kind === 'room-notice') { // Room live feed: read the turn record directly (allowlisted kind), never the feed itself
    const t = allow.read(path.join(allow.cfg.roomData, 'turns', String(d.key) + '.json'));
    return { id: e.id, source: src, sections: t.allowed && t.content ? [{ title: 'turn record (.room-data)', path: t.path, allowed: true, ...clip(t.content) }] : [{ title: 'turn record', path: t.path, allowed: t.allowed, note: t.missing ? 'not found' : 'off-allowlist: path only' }] };
  }
  if (!allow.allowsSource(d.file)) return { id: e.id, source: src, sections: [{ title: 'source', path: d.file, allowed: false, note: 'source file is outside the allowlist: path only' }] };
  const add = (title: string, s: string | undefined, extra: Partial<Section> = {}) => { if (s != null && s !== '') out.push({ title, ...clip(s), ...extra }); };
  const gate = (title: string, p: string, s: string | undefined) => { if (!allow.allows(p)) out.push({ title, path: p, allowed: false, note: 'off-allowlist: path only' }); else add(title, s, { path: p, allowed: true }); };
  const tgtPath = e.target?.kind === 'file' ? e.target.path! : undefined;
  switch (d.kind) {
    case 'claude-tool': {
      const rec = json(lineAt(c, d.file, d.lines[0])), use = rec?.message?.content?.find((b: any) => b.type === 'tool_use' && b.id === d.key), inp = use?.input || {};
      if (d.extra?.think != null) { const t = json(lineAt(c, d.file, d.extra.think as number)); add('thinking before this call', (t?.message?.content || []).filter((b: any) => b.type === 'thinking').map((b: any) => b.thinking).join('\n'), { prose: true }); }
      const results = d.lines.slice(1).map(n => json(lineAt(c, d.file, n))).filter(Boolean);
      const result = results.map(r => Array.isArray(r.message?.content) ? r.message.content.filter((b: any) => b.type === 'tool_result' && b.tool_use_id === d.key).map((b: any) => textOf(b.content)).join('\n') : textOf(r.message?.content)).join('\n---\n');
      const name = use?.name;
      out.push(...toolSections(allow, name, inp, result, rec?.cwd || allow.cfg.home, tgtPath));
      if ((name === 'Agent' || name === 'Task') && e.target?.id.startsWith('agent:')) out.push(...actorContext(c, e.target.id, false));
      break;
    }
    case 'claude-text': { const r = json(lineAt(c, d.file, d.lines[0])); add('text', textOf(r?.message?.content), { prose: true }); break; }
    case 'claude-user': { const r = json(lineAt(c, d.file, d.lines[0])); add('message', textOf(r?.message?.content)); break; }
    case 'claude-notification': { const r = json(lineAt(c, d.file, d.lines[0])); add('message', textOf(r?.message?.content), { prose: true }); break; } // carries the agent's result text
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
        const x = execOf(L, { kind: 'exec', start: d.lines[0], end: d.lines[1] }), cwd = x.cwd || '/';
        const secs = commandSections(allow, x.inner, cwd, x.output, { title: 'command (derived from log text)', outTitle: 'output (derived from log text)', shown: x.raw + (x.cwd ? `\n  in ${x.cwd}` : ''), understood: x.wrapped });
        out.push(secs[0]); add('status', x.status.trim()); out.push(...secs.slice(1));
      } else add(d.kind === 'codex-final' ? 'final message (derived from log text)' : 'log section', body, { prose: true });
      if (d.kind === 'codex-final') out.push(...actorContext(c, e.actor.id, false));
      break;
    }
    case 'spool-hook': case 'spool-codex': { // records were filtered + redacted at write; clip() redacts again at read
      const recs = d.lines.map(n => json(lineAt(c, d.file, n))).filter(Boolean);
      // prose is decided here, on read, from the record (item type, record kind, hook event, section): a stored flag is not trusted
      const PROSE_ITEMS = /^(agent_message|assistant_message|reasoning|error)$/;
      const isProse = (r: any, x: Section) => !!x.prose || PROSE_ITEMS.test(r?.item?.type || '') || r?.type === 'error' || r?.type === 'turn.failed' || r?.kind === 'end'
        || r?.event === 'SubagentStop' || /^(final message|final output|launch result|reasoning|thinking)/.test(x.title);
      const resec = (x: Section, r?: any) => { const y = x.text != null ? { ...x, ...clip(String(x.text)) } : { ...x }; if (isProse(r, x)) y.prose = true; else delete y.prose; return y; };
      if (d.kind === 'spool-codex' && d.key && (e.verb === 'spawn' || e.verb === 'end')) {
        const all = fileLines(c, d.file).map(json).filter((r: any) => r?.run === d.key).sort((a: any, b: any) => a.seq - b.seq);
        const st = all.find((r: any) => r.kind === 'start'); if (st) out.push({ title: 'run', ...clip(`role: ${st.role || '?'}  label: ${st.label || '?'}\ncwd: ${st.cwd}\nargs: ${(st.args || []).join(' ')}`) });
        for (const r of all) for (const x of (r.item?.sections || r.sections || []) as Section[]) out.push(resec({ ...x, title: r.kind === 'end' ? 'final message' : x.title }, r));
        break;
      }
      const last = recs[recs.length - 1];
      for (const x of ((last?.item?.sections || last?.sections || []) as Section[])) out.push(resec(x, last));
      if (e.verb === 'spawn' && e.target?.id.startsWith('agent:')) out.push(...actorContext(c, e.target.id, false));
      if (!out.length) out.push({ title: 'event', note: 'no content recorded for this event' });
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
    if (e.detailRef.kind === 'codex-exec' || e.detailRef.kind === 'spool-codex') { // one command read several files: its output is shown once, not split by guesswork
      const k = e.detailRef.lines.join(',');
      if (!shown.has(k)) { shown.add(k); const secs = expandEvent(c, e).sections; out.push(...secs.filter(s => /^(command|output)/.test(s.title)).map(s => ({ ...s, title: s.title.startsWith('command') ? 'command' : s.title }))); }
      out.push({ title: 'read', path: p, allowed: true, note: 'content is in the command output above (derived)' }); continue;
    }
    const sec = expandEvent(c, e).sections.find(s => /file read|^output/.test(s.title));
    out.push({ title: 'read', path: p, allowed: sec?.allowed !== false, ...(sec?.text ? { text: sec.text, truncated: sec.truncated, note: e.provenance === 'captured' ? 'as the agent saw it' : 'command output (derived)' } : { note: sec?.note || 'no captured content' }) });
  }
  for (const e of evs.filter(e => e.verb === 'write' && e.target?.kind === 'file')) out.push(...expandEvent(c, e).sections.filter(s => s.title === 'written').map(s => ({ ...s, title: 'wrote' })));
  const end = evs.find(e => e.verb === 'end');
  if (end?.detailRef.kind === 'claude-subagent-end' && end.detailRef.lines.length) { const r = json(lineAt(c, end.detailRef.file, end.detailRef.lines[0])); const t = textOf(r?.message?.content); if (t) out.push({ title: 'final output', prose: true, ...clip(t) }); }
  return out;
}
