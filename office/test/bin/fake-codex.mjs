#!/usr/bin/env node
// Stand-in for `codex exec --json` in wrapper tests. Behaviour comes from FAKE_* env; it records what it received.
import fs from 'node:fs';
const argv = process.argv.slice(2), E = process.env, rec = { argv, stdin: '' };
const oi = argv.indexOf('-o'), out = oi >= 0 ? argv[oi + 1] : null;
const save = () => E.FAKE_RECORD && fs.writeFileSync(E.FAKE_RECORD, JSON.stringify(rec));
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const main = () => {
  save(); process.stderr.write(E.FAKE_STDERR ?? 'fake codex stderr\n');
  emit({ type: 'thread.started', thread_id: 'thread-1' }); emit({ type: 'turn.started' });
  for (const line of (E.FAKE_EVENTS ? JSON.parse(E.FAKE_EVENTS) : [])) emit(line);
  if (E.FAKE_NOISE) process.stdout.write('not json at all\n');
  emit({ type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 5 } });
  if (out && E.FAKE_FINAL != null) fs.writeFileSync(out, E.FAKE_FINAL);
  if (E.FAKE_SLEEP) { process.on('SIGTERM', () => { rec.gotSignal = 'SIGTERM'; save(); process.kill(process.pid, 'SIGKILL'); }); process.on('SIGINT', () => { rec.gotSignal = 'SIGINT'; save(); process.exit(130); }); setInterval(() => {}, 1000); return; }
  if (E.FAKE_SIGNAL) { process.kill(process.pid, E.FAKE_SIGNAL); return; }
  process.exit(Number(E.FAKE_EXIT || 0));
};
if (!process.stdin.isTTY) { process.stdin.on('data', b => rec.stdin += b); process.stdin.on('end', main); } else main();
