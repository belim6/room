import { Engine } from './engine';
import { id } from './store';
// Run records track today's browser-driven bounded runs. The server never schedules turns itself and never resumes a run.
export type RunStatus = 'running' | 'completed' | 'stopped' | 'interrupted' | 'failed';
export interface Run { id: string; branch: string; startedAt: string; startedBy: string; policy: { kind: 'random' | 'alternate' | 'fixed'; speaker?: string }; maxTurns: number;
  transitions: { at: string; status: RunStatus; reason?: string }[]; turns: string[]; usage: { input: number; output: number; reasoning: number; missing: number }; head: string; updatedAt: string }
const now = () => new Date().toISOString();
export const statusOf = (r: Run) => r.transitions.at(-1)!.status;
export class Runs {
  // A browser that stops advancing is assumed gone after this long without a turn (ROOM_RUN_TIMEOUT_MS, default 60 s).
  timeoutMs = Number(process.env.ROOM_RUN_TIMEOUT_MS || 60000);
  pending = new Map<string, { index: number; turnId: string; done: Promise<unknown> }>();
  timers = new Map<string, NodeJS.Timeout>();
  constructor(public engine: Engine) {}
  get store() { return this.engine.store; }
  private save(r: Run) { r.updatedAt = now(); this.store.put('runs', r.id, r); return r; }
  private transition(r: Run, status: RunStatus, reason?: string) { if (statusOf(r) !== 'running') return r; r.transitions.push({ at: now(), status, ...(reason ? { reason } : {}) }); clearTimeout(this.timers.get(r.id)); this.timers.delete(r.id); return this.save(r); }
  // Status is projected from the record, then checked against the branch: a stale "running" is never reported as running.
  get(key: string): Run {
    const r = this.store.get<Run>('runs', key);
    if (statusOf(r) !== 'running' || this.pending.has(key) || this.store.readOnly) return r;
    let head: string | null = null; try { head = this.engine.read(r.branch).head; } catch {}
    if (head !== r.head) return this.transition(r, 'interrupted', 'The conversation changed outside this run');
    if (Date.now() - Date.parse(r.updatedAt) > this.timeoutMs) return this.transition(r, 'interrupted', 'No next turn arrived in time; the browser may have closed');
    return r;
  }
  list(branch: string) { return this.store.list<Run>('runs').filter(r => r.branch === branch).map(r => this.get(r.id)).sort((a, b) => a.startedAt.localeCompare(b.startedAt)); }
  active(branch: string) { return this.list(branch).find(r => statusOf(r) === 'running') ?? null; }
  private watch(r: Run) {
    clearTimeout(this.timers.get(r.id));
    this.timers.set(r.id, setTimeout(() => { try { this.get(r.id); } catch {} }, this.timeoutMs + 50).unref());
  }
  start(branch: string, input: any) {
    const b = this.engine.read(branch), s = b.revision.state, policy = input.policy ?? { kind: 'random' }, maxTurns = input.maxTurns;
    if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 20) throw Error('Choose 1–20 turns');
    if (!policy || !['random', 'alternate', 'fixed'].includes(policy.kind) || (policy.speaker !== undefined && typeof policy.speaker !== 'string') || (policy.kind === 'fixed' && !policy.speaker)) throw Error('Invalid run policy');
    if (b.head !== input.expected) throw Error('This conversation changed. Reload before continuing.');
    if (!s.participants.length) throw Error('Add a person to this room before generating');
    if (policy.speaker && !s.participants.includes(policy.speaker)) throw Error('Selected character is not participating');
    if (policy.kind === 'alternate' && s.participants.length !== 2) throw Error('Back-and-forth needs exactly two participants');
    if (this.active(branch) || this.engine.active.has(branch)) throw Error('Another run is already advancing in this conversation');
    const at = now(), r: Run = { id: id(), branch, startedAt: at, startedBy: typeof input.startedBy === 'string' ? input.startedBy.slice(0, 40) : 'browser',
      policy: { kind: policy.kind, ...(policy.speaker ? { speaker: policy.speaker } : {}) }, maxTurns, transitions: [{ at, status: 'running' }], turns: [], usage: { input: 0, output: 0, reasoning: 0, missing: 0 }, head: b.head, updatedAt: at };
    this.save(r); this.watch(r); return r;
  }
  usage(r: Run) {
    const turns = new Set(r.turns), u = { input: 0, output: 0, reasoning: 0, missing: 0 };
    // Retries count; an attempt whose provider reported no usage is missing, not zero.
    for (const a of this.store.attempts().filter(a => turns.has(a.turnId) && a.outcome)) {
      const x = a.outcome.usage; if (!x) { u.missing++; continue; }
      u.input += x.prompt_tokens ?? x.input_tokens ?? 0; u.output += x.completion_tokens ?? x.output_tokens ?? 0; u.reasoning += x.completion_tokens_details?.reasoning_tokens ?? 0;
    }
    return u;
  }
  // Only the next consecutive index advances. Resubmitting an index returns the existing turn and never dispatches.
  async advance(key: string, index: unknown) {
    if (!Number.isInteger(index) || (index as number) < 1) throw Error('Invalid turn index');
    const n = index as number, pending = this.pending.get(key);
    let r = this.get(key);
    if (n <= r.turns.length) {
      const turnId = r.turns[n - 1], record = pending?.turnId === turnId ? null : this.store.list('turns').find(t => t.id === turnId);
      return { run: r, turnId, status: record?.status ?? 'pending', duplicate: true };
    }
    if (statusOf(r) !== 'running') throw Error(`This run is ${statusOf(r)}`);
    if (n !== r.turns.length + 1) throw Error('Runs advance one consecutive turn at a time');
    if (n > r.maxTurns) throw Error('This run has reached its turn limit');
    const turnId = id(), alternate = r.policy.kind === 'alternate';
    r.turns.push(turnId); this.save(r); clearTimeout(this.timers.get(key));
    const forced = r.policy.kind === 'fixed' || (alternate && n === 1) ? r.policy.speaker : undefined;
    const done = this.engine.turn(r.branch, r.head, forced, { id: r.id, index: n, count: r.maxTurns, ...(alternate ? { mode: 'alternate' as const } : {}) }, undefined, { turnId });
    this.pending.set(key, { index: n, turnId, done }); let error: any = null;
    try { await done; } catch (e) { error = e; } finally { this.pending.delete(key); }
    r = this.store.get<Run>('runs', key);
    const turn = this.store.list('turns').find(t => t.id === turnId);
    r.usage = this.usage(r);
    if (turn?.status === 'attached') {
      r.head = turn.revision;
      if (n === r.maxTurns) this.transition(r, 'completed'); else { this.save(r); if (statusOf(r) === 'running') this.watch(r); }
    } else if (turn?.status === 'detached') this.transition(r, 'interrupted', 'The conversation changed while a turn was running');
    else if (turn?.status === 'canceled') this.transition(r, 'stopped', 'Stopped');
    else this.transition(r, 'failed', error?.message || turn?.error || 'The turn failed');
    if (statusOf(r) !== 'running') this.save(r);
    return { run: r, turnId, status: turn?.status ?? 'failed', ...(error ? { error: error.message } : {}) };
  }
  // Stop is final: nothing further is dispatched, and a response that arrives later is stored as canceled.
  stop(key: string) {
    const r = this.store.get<Run>('runs', key), pending = this.pending.get(key);
    this.transition(r, 'stopped', 'Stopped by you');
    if (pending && this.engine.active.get(r.branch)?.turnId === pending.turnId) this.engine.cancel(r.branch);
    return this.store.get<Run>('runs', key);
  }
  recover() { if (this.store.readOnly) return; for (const r of this.store.list<Run>('runs')) if (statusOf(r) === 'running') this.transition(r, 'interrupted', 'The server restarted; runs are never resumed'); }
}
