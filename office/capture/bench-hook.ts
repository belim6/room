// p50/p95 wall time of the hook script over N synthetic tool calls (default 100), into a throwaway spool.
//   node --no-warnings office/capture/bench-hook.ts [N]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { config } from '../collect/privacy.ts';

const N = Number(process.argv[2] || 100), here = path.dirname(path.resolve(process.argv[1])), cfg = config();
const spool = fs.mkdtempSync(path.join(os.tmpdir(), 'office-bench-')), D = path.join(cfg.coordination, '2026-10-17/date');
const payloads = [
  { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(D, 'rubric-v1.md') } },
  { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: path.join(D, 'rubric-v1.md') }, tool_response: { file: { content: 'x'.repeat(8000) } } },
  { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'cat labeler-prompt.md | head -5', description: 'peek' } },
  { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'cat labeler-prompt.md | head -5' }, tool_response: { stdout: 'y'.repeat(4000), stderr: '' } },
  { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: path.join(D, 'labels/claude/T-x.json'), content: '{"a":1}' } },
];
const ms: number[] = [];
for (let i = 0; i < N; i++) {
  const input = JSON.stringify({ session_id: 'bench', cwd: D, tool_use_id: 'tu' + i, ...payloads[i % payloads.length] }), t = process.hrtime.bigint();
  const r = spawnSync(process.execPath, ['--no-warnings', path.join(here, 'hook.ts')], { input, env: { ...process.env, OFFICE_SPOOL: spool } });
  ms.push(Number(process.hrtime.bigint() - t) / 1e6); if (r.status !== 0) console.error('non-zero exit', r.status);
}
const s = [...ms].sort((a, b) => a - b), q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
const lines = fs.readdirSync(spool).filter(n => n.startsWith('hooks-')).map(n => fs.readFileSync(path.join(spool, n), 'utf8').split('\n').filter(Boolean).length).reduce((a, b) => a + b, 0);
console.log(JSON.stringify({ n: N, p50_ms: +q(0.5).toFixed(1), p95_ms: +q(0.95).toFixed(1), max_ms: +s[s.length - 1].toFixed(1), spooled: lines, errors: fs.existsSync(path.join(spool, 'errors.count')) ? fs.readFileSync(path.join(spool, 'errors.count'), 'utf8').split('\n').filter(Boolean).length : 0 }));
fs.rmSync(spool, { recursive: true, force: true });
