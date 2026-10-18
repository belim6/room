import fs from 'node:fs';
import path from 'node:path';
import { Sink, type OfficeEvent, type Verb } from './types';
import { readLines, agentKind } from './claude';
import { verdictOf, findingsOf } from './codex';
import type { Allowlist } from './privacy';

// The live spool (hooks-*.jsonl from the Claude Code hook, codex-*.jsonl from office-codex). Records were filtered and
// redacted before they were written; Expand redacts again. Hook events are `captured`; file effects of shell commands are
// `derived` from the command text, as in O1. Duplicates of transcript events (same tool_use id) are dropped: the
// transcript copy wins and the hook copy only confirms it.
// One spawn per actor, one end per actor, one event per (tool call, verb, file): whichever source reported it first wins.
export const dedupeKey = (e: OfficeEvent) => e.verb === 'spawn' && e.target?.kind === 'actor' && !e.target.id.startsWith('tool:') ? `spawn|${e.target.id}` : e.verb === 'end' ? `end|${e.actor.id}`
  : e.detailRef.key ? `${e.detailRef.key}|${e.verb}|${e.target?.kind === 'file' ? e.target.path : ''}` : '';

export function spoolFiles(dir: string) { return fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => /^(hooks|codex)-\d{4}-\d\d-\d\d\.jsonl$/.test(n)).sort().map(n => path.join(dir, n)) : []; }

export function parseSpool(file: string, sink: Sink, allow: Allowlist, opts: { primarySession?: string; known?: Set<string> }) {
  const stat = { kind: path.basename(file).startsWith('hooks') ? 'spool-hooks' : 'spool-codex', path: file, records: 0, events: 0, unparsed: 0, note: '' as string | undefined };
  sink.sources.push(stat); let deduped = 0;
  const recs: { r: any; i: number }[] = [];
  const ids = new Set<string>(); // a record appended twice (retry) counts once
  readLines(file, sink).forEach((l, i) => { if (!l.trim()) return; try { const r = JSON.parse(l); if (r?.v !== 1 || !r.ts || !Number.isFinite(Date.parse(r.ts))) throw 0; if (r.id && ids.has(r.id)) { deduped++; return; } if (r.id) ids.add(r.id); recs.push({ r, i }); stat.records++; } catch { stat.unparsed++; } });
  recs.sort((a, b) => a.r.ts.localeCompare(b.r.ts) || a.i - b.i); // delayed / out-of-order appends
  const seen = new Set<string>(), push = (e: Omit<OfficeEvent, 'id' | 'seq' | 'derived'>) => {
    const ev = sink.push(e), k = dedupeKey(ev);
    if (k && (opts.known?.has(k) || seen.has(k))) { sink.events.pop(); deduped++; return null; }
    if (k) seen.add(k); stat.events++; return ev;
  };
  const who = (r: any) => r.agent ? 'agent:' + r.agent : !r.session || r.session === opts.primarySession ? 'coordinator' : 'session:' + String(r.session).slice(0, 8);
  if (stat.kind === 'spool-hooks') {
    const byTool = new Map<string, { pre?: { r: any; i: number }; post?: { r: any; i: number } }>();
    for (const x of recs) if (x.r.toolUseId) { const g = byTool.get(x.r.toolUseId) || {}; if (x.r.event === 'PreToolUse') g.pre ??= x; else if (x.r.event === 'PostToolUse') g.post ??= x; byTool.set(x.r.toolUseId, g); }
    for (const x of recs) {
      const r = x.r, me = who(r), base = { source: file, provenance: 'captured' as const, tsSource: 'record' as const };
      if (me !== 'coordinator' && !sink.actors.has(me)) sink.actor({ id: me, kind: me.startsWith('agent:') ? agentKind(r.agentType || '') : 'coordinator', label: me.startsWith('agent:') ? (r.agentType || 'agent') + ' ' + r.agent.slice(0, 7) : 'session ' + me.slice(8) });
      if (r.toolUseId) {
        const g = byTool.get(r.toolUseId)!; if ((g.pre || g.post) !== x) continue; // one event set per tool call, at its first record
        const done = g.post?.r, lines = [g.pre?.i, g.post?.i].filter((n): n is number => n != null), d = { kind: 'spool-hook', file, lines, key: r.toolUseId };
        const extra = { ...(done ? { outcome: done.outcome, cost: { ms: Date.parse(done.ts) - Date.parse(r.ts) } } : { outcome: 'running' }) };
        const ev = (verb: Verb, target: OfficeEvent['target'], provenance: 'captured' | 'derived' = 'captured', label?: string) =>
          push({ ...base, ts: r.ts, actor: sink.ref(me), verb, target, detailRef: d, provenance, ...extra, ...(label ? { label } : {}), hints: [r.target || '', ...(r.reads || []), ...(r.writes || []), r.cwd || '', ...((r.sections || []) as any[]).filter(s => s.title === 'prompt').map(s => String(s.text || ''))] });
        const t = r.tool, file_ = (p: string) => ({ kind: 'file', id: p, path: p });
        if (t === 'Read' || t === 'NotebookRead') ev('read', file_(r.target));
        else if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(t)) ev('write', file_(r.target));
        else if (t === 'Agent' || t === 'Task') { const a = done?.agentId; if (a) sink.actor({ id: 'agent:' + a, kind: agentKind(r.label), label: r.label || sink.actors.get('agent:' + a)?.label || 'agent ' + a.slice(0, 7), parent: me }); ev('spawn', { kind: 'actor', id: a ? 'agent:' + a : 'tool:' + r.toolUseId }, 'captured', r.label); }
        else if (t === 'SendMessage') ev('message', { kind: 'actor', id: /^a[0-9a-f]{10,}$/.test(r.to || '') ? 'agent:' + r.to : 'name:' + (r.to || '?') });
        else if (t === 'Bash') { for (const p of r.reads || []) ev('read', file_(p), 'derived'); for (const p of r.writes || []) ev('write', file_(p), 'derived'); if (!(r.reads || []).length && !(r.writes || []).length) ev('dispatch', { kind: 'command', id: r.toolUseId }, 'captured', r.label); }
        else if (t === 'Grep' || t === 'Glob') ev('read', file_(r.cwd || '/'), 'derived');
        else ev('dispatch', { kind: 'tool', id: t }, 'captured', t);
        continue;
      }
      const d = { kind: 'spool-hook', file, lines: [x.i] };
      if (r.event === 'UserPromptSubmit') push({ ...base, ts: r.ts, actor: sink.ref('deniz'), verb: 'message', target: { kind: 'actor', id: me }, detailRef: d });
      else if (r.event === 'SubagentStart' && r.agent) { const parent = sink.actors.get(me)?.parent || 'coordinator'; if (!sink.actors.get(me)?.parent) sink.actor({ id: me, kind: sink.actors.get(me)?.kind || agentKind(r.agentType || ''), label: sink.actors.get(me)?.label || r.agentType || 'agent', parent }); push({ ...base, ts: r.ts, actor: sink.ref(parent), verb: 'spawn', target: { kind: 'actor', id: me }, detailRef: d }); }
      else if (r.event === 'SubagentStop' && r.agent) push({ ...base, ts: r.ts, actor: sink.ref(me), verb: 'end', target: { kind: 'actor', id: sink.actors.get(me)?.parent || 'coordinator' }, detailRef: d, outcome: 'done' });
    }
  } else {
    const runs = new Map<string, { r: any; i: number }[]>();
    for (const x of recs) (runs.get(x.r.run) || runs.set(x.r.run, []).get(x.r.run)!).push(x);
    for (const [run, xs] of runs) {
      const start = xs.find(x => x.r.kind === 'start')?.r || xs[0].r, end = xs.find(x => x.r.kind === 'end'), id = 'codexrun:' + run;
      const role = String(start.role || ''), kind = role === 'critic' ? 'critic' : role === 'labeler' ? 'labeler' : role || 'reviewer';
      sink.actor({ id, kind, label: start.label || `Codex ${role || 'run'} ${run.slice(0, 8)}`, parent: role === 'critic' ? 'critic' : 'coordinator', source: file, ...(start.operation ? { operation: String(start.operation) } : {}) });
      const parent = role === 'critic' ? 'critic' : 'coordinator', op = start.operation ? { operation: String(start.operation), opInferred: false } : {};
      const prompt = xs.find(x => x.r.kind === 'prompt')?.r?.sections?.[0]?.text || '';
      const base = { source: file, provenance: 'captured' as const, tsSource: 'record' as const, ...op };
      push({ ...base, ts: xs[0].r.ts, actor: sink.ref(parent), verb: 'spawn', target: { kind: 'actor', id }, detailRef: { kind: 'spool-codex', file, lines: xs.filter(x => x.r.kind === 'start' || x.r.kind === 'prompt').map(x => x.i), key: run }, label: start.label, hints: [start.cwd || '', prompt, ...(start.args || [])] });
      let tokens = 0;
      for (const x of xs) {
        const r = x.r, it = r.item, d = { kind: 'spool-codex', file, lines: [x.i] };
        if (r.usage) tokens += (r.usage.input || 0) + (r.usage.output || 0);
        if (r.type === 'error' || r.type === 'turn.failed') push({ ...base, ts: r.ts, actor: sink.ref(id), verb: 'error', target: { kind: 'actor', id: 'providers' }, detailRef: d, outcome: 'error', label: 'Codex error' });
        if (!it || r.type !== 'item.completed') continue;
        const fail = it.exitCode != null && it.exitCode !== 0 ? 'error' : 'ok', hints = [...(it.reads || []), ...(it.writes || []), start.cwd || ''];
        if (it.type === 'command_execution') {
          for (const p of it.reads || []) push({ ...base, ts: r.ts, actor: sink.ref(id), verb: 'read', target: { kind: 'file', id: p, path: p }, detailRef: d, provenance: 'derived', outcome: fail, hints });
          for (const p of it.writes || []) push({ ...base, ts: r.ts, actor: sink.ref(id), verb: 'write', target: { kind: 'file', id: p, path: p }, detailRef: d, provenance: 'derived', outcome: fail, hints });
          if (!(it.reads || []).length && !(it.writes || []).length) push({ ...base, ts: r.ts, actor: sink.ref(id), verb: 'dispatch', target: { kind: 'command', id: `${run}:${r.seq}` }, detailRef: d, outcome: fail, hints });
        } else if (it.type === 'file_change') for (const c of it.paths || []) push({ ...base, ts: r.ts, actor: sink.ref(id), verb: 'write', target: { kind: 'file', id: c.path, path: c.path }, detailRef: d, hints });
      }
      if (end) {
        const r = end.r, fin = String(r.sections?.[0]?.text || ''), sig = r.exit?.signal, code = r.exit?.code;
        let outcome = sig || (code != null && code !== 0) ? 'error' : !fin ? 'no-output' : role === 'critic' ? verdictOf(fin) || 'done' : role === 'labeler' ? (() => { try { JSON.parse(fin.slice(fin.indexOf('{'))); return 'verdict'; } catch { return 'extraction-failed'; } })() : 'done';
        push({ ...base, ts: r.ts, actor: sink.ref(id), verb: 'end', target: { kind: 'actor', id: parent }, detailRef: { kind: 'spool-codex', file, lines: [end.i], key: run }, outcome, cost: { calls: 1, tokens: tokens || undefined },
          ...(role === 'critic' && findingsOf(fin) ? { findings: findingsOf(fin) } : {}) } as any);
      }
    }
  }
  if (deduped) stat.note = `${deduped} duplicates dropped (repeated records, or tool calls already in transcripts)`; else delete stat.note;
}
