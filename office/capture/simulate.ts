// A synthetic labeling run written through the real capture path (hookRecord / codexRecord -> sanitize -> append), for
// tests and for previewing live mode without spending: N Claude labelers (as hook events) and N Codex labelers (as
// office-codex events), each opening the instructions, its blind transcript and the rubric, then returning a verdict.
//   node --no-warnings office/capture/simulate.ts <spool-dir> [pace-ms]     (spool dir must not be the real one for demos)
import fs from 'node:fs';
import path from 'node:path';
import { hookRecord, codexRecord, append, Allowlist, config } from './sanitize.ts';
import type { Config } from '../collect/privacy.ts';

export interface SimOpts { cfg: Config; dir: string; ids: string[]; rubric: string; t0: number; stepMs: number; primarySession: string; operation: string; tail?: string }
export function* simulate(o: SimOpts): Generator<{ kind: 'hooks' | 'codex'; rec: any }> {
  const allow = new Allowlist(o.cfg), D = o.dir, read = (p: string) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
  let k = 0; const at = () => new Date(o.t0 + (k++) * o.stepMs).toISOString();
  const hook = (h: any) => ({ kind: 'hooks' as const, rec: hookRecord({ session_id: o.primarySession, cwd: D, ...h }, allow, at()) });
  const files = (id: string) => [path.join(D, 'labeler-prompt.md'), path.join(D, 'blind', id + '.md'), path.join(D, o.rubric)];
  for (const [n, id] of o.ids.entries()) {
    const aid = 'a' + (0xa000000000000000n + BigInt(n * 7919)).toString(16).slice(0, 16), tu = `toolu_sim_${n}`, tail = o.tail ?? '';
    // Claude labeler, seen through hooks
    const prompt = `Read ONLY these files, nothing else: ${files(id).join(', ')}. Label the conversation strictly by the rubric.${tail}`;
    yield hook({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: tu, tool_input: { description: `Label ${id}`, subagent_type: 'general-purpose', prompt, run_in_background: true } });
    yield hook({ hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: tu, tool_input: { description: `Label ${id}` }, tool_response: { status: 'async_launched', agentId: aid } });
    yield hook({ hook_event_name: 'SubagentStart', agent_id: aid, agent_type: 'general-purpose' });
    for (const [j, f] of files(id).entries()) {
      yield hook({ hook_event_name: 'PreToolUse', agent_id: aid, tool_name: 'Read', tool_use_id: `${tu}_r${j}`, tool_input: { file_path: f } });
      yield hook({ hook_event_name: 'PostToolUse', agent_id: aid, tool_name: 'Read', tool_use_id: `${tu}_r${j}`, tool_input: { file_path: f }, tool_response: { type: 'text', file: { filePath: f, content: read(f) + tail } } });
    }
    const out = path.join(D, 'labels/claude', id + '.json'), verdict = JSON.stringify({ transcript: id, messages: [], realism: 3 });
    yield hook({ hook_event_name: 'PreToolUse', agent_id: aid, tool_name: 'Write', tool_use_id: `${tu}_w`, tool_input: { file_path: out, content: verdict } });
    yield hook({ hook_event_name: 'PostToolUse', agent_id: aid, tool_name: 'Write', tool_use_id: `${tu}_w`, tool_input: { file_path: out, content: verdict }, tool_response: { type: 'create', filePath: out } });
    yield hook({ hook_event_name: 'SubagentStop', agent_id: aid, last_assistant_message: 'done' });
    // Codex labeler, seen through office-codex
    const run = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, meta = { role: 'labeler', label: `Codex labeler ${id}`, operation: o.operation, cwd: D };
    let seq = 0; const cx = (r: any) => ({ kind: 'codex' as const, rec: r });
    yield cx({ v: 1, src: 'codex', ts: at(), run, seq: seq++, kind: 'start', resume: false, ...meta, id: run + ':start', args: ['-C', D, '-s', 'read-only', '-'] });
    yield cx({ v: 1, src: 'codex', ts: at(), run, seq: seq++, kind: 'prompt', id: run + ':prompt', sections: [{ title: 'prompt', text: `Read ONLY these files in ${D}: labeler-prompt.md, blind/${id}.md, ${o.rubric}.` }] });
    const cmd = `/bin/zsh -lc 'cat labeler-prompt.md blind/${id}.md ${o.rubric}'`;
    yield cx(codexRecord({ type: 'item.completed', item: { id: 'item_0', type: 'command_execution', command: cmd, aggregated_output: files(id).map(read).join('') + tail, exit_code: 0, status: 'completed' } }, run, seq++, allow, D, meta, at()));
    yield cx(codexRecord({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: verdict } }, run, seq++, allow, D, meta, at()));
    yield cx(codexRecord({ type: 'turn.completed', usage: { input_tokens: 4000, cached_input_tokens: 0, output_tokens: 300 } }, run, seq++, allow, D, meta, at()));
    yield cx({ v: 1, src: 'codex', ts: at(), run, seq: seq++, kind: 'end', id: run + ':end', exit: { code: 0, signal: null }, ...meta, sections: [{ title: 'final message', text: verdict }] });
  }
}
export function writeAll(spool: string, recs: Iterable<{ kind: 'hooks' | 'codex'; rec: any }>) { for (const { kind, rec } of recs) append(spool, kind, [rec], rec.ts); }

if (process.argv[1] && /simulate\.ts$/.test(process.argv[1])) {
  const spool = process.argv[2], pace = Number(process.argv[3] || 400), cfg = { ...config(), spool };
  if (!spool || path.resolve(spool) === path.resolve(config().spool!)) { console.error('usage: simulate.ts <temp-spool-dir> [pace-ms]  (not the real spool)'); process.exit(2); }
  const D = path.join(cfg.coordination, '2026-10-17/date'), ids = fs.readdirSync(path.join(D, 'blind')).filter(n => /^T-.*\.md$/.test(n)).map(n => n.slice(0, -3)).sort();
  const sim = [...simulate({ cfg, dir: D, ids, rubric: 'rubric-v1.1.md', t0: Date.now(), stepMs: pace, primarySession: process.env.OFFICE_SIM_SESSION || 'sim-session', operation: '2026-10-17/date/labeling' })];
  let i = 0; const t = setInterval(() => { const x = sim[i++]; if (!x) { clearInterval(t); console.log('done', sim.length, 'records'); return; } x.rec.ts = new Date().toISOString(); append(spool, x.kind, [x.rec], x.rec.ts); }, pace);
}
