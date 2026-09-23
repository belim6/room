import { createHash } from 'node:crypto';
import { Store, id } from './store';
import type { State } from './engine';
export async function shadowJev(store: Store, state: State, branch: string, revision: string, turnId: string, transport: typeof fetch = fetch) {
  const questions = {
    next_speaker: { type: 'choice', instructions: 'Choose the participant whose specific concerns can most advance the latest_message in transcript. Refer to character criteria. Avoid the last speaker when alternatives exist. Do not choose for fairness.',
      criteria: Object.fromEntries(state.participants.map(p => [p, { what: state.characters[p].prompt }])) },
    needs_research: { type: 'noul', instructions: 'Would answering the latest_message materially benefit from looking up a verifiable external fact not already present in transcript? Values, jokes and speculation alone do not require research.' },
  };
  const transcript = state.messages.slice(-20).map(m => `${m.speaker}: ${m.text}`);
  const body = { model: 'jev-latest', state: { room: state.system, participants: state.participants, transcript,
    latest_message: transcript.at(-1) || '(none)', last_speaker: state.messages.at(-1)?.speaker || '(none)' }, questions };
  const key = id(); const start = Date.now();
  store.put('jev-requests', key, { id: key, branch, revision, turnId, mode: 'shadow', at: new Date().toISOString(),
    endpoint: 'https://api.typesafe.ai/v1/systemone', body,
    instructionVersion: createHash('sha256').update(JSON.stringify(questions)).digest('hex') });
  let raw: string | null = null;
  try {
    if (!process.env.TYPESAFE_API_KEY) throw Error('TYPESAFE_API_KEY missing; shadow observation skipped');
    const res = await transport('https://api.typesafe.ai/v1/systemone', { method: 'POST',
      headers: { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(4000) });
    raw = await res.text();
    if (!res.ok) throw Error(`Jev HTTP ${res.status}`);
    const parsed = JSON.parse(raw);
    if (!parsed.answers?.next_speaker) throw Error('Unexpected Jev response shape');
    store.put('jev-results', key, { id: key, raw, answers: parsed.answers, usage: parsed.usage ?? null, latencyMs: Date.now() - start, status: 'completed' });
  } catch (e: any) {
    store.put('jev-results', key, { id: key, raw, error: e.message, latencyMs: Date.now() - start, status: 'failed' });
  }
}
