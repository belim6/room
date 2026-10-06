// Legacy request shapes. Golden fixtures in tests/fixtures/legacy-requests.json were captured from these
// scenarios with the pre-reorganization code; the identity work must keep these request bodies byte-identical.
import { Store } from '../src/workbench/store';
import { Engine, initialState } from '../src/workbench/engine';
import { DEFAULT_FRAME } from '../src/speakerTurn';
type Step = { message?: string; turn?: string; run?: { id: string; index: number; count: number; mode?: 'alternate' }; wrongFirst?: string };
const reply = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }));
export const scenarios: Record<string, { state: () => any; steps: Step[] }> = {
  'default-8': { state: () => { const s: any = initialState(); delete s.frame; s.characters.Boris.memory = 'Remembered fact.'; return s; },
    steps: [{ message: 'Hello everyone.' }, { turn: 'Boris', wrongFirst: 'Elorin: Not me.' }, { turn: 'Ilya' }] },
  'default-8-new-room-frame': { state: () => initialState(),
    steps: [{ message: 'Hello everyone.' }, { turn: 'Rook', wrongFirst: '**Velric:** wrong one' }, { turn: 'Ceryn' }] },
  'custom-frame': { state: () => ({ ...initialState(), frame: { ...DEFAULT_FRAME, identity: 'You are {speaker}.', turn: 'Participants: {participants}. Speak as {speaker}.' } }),
    steps: [{ turn: 'Boris' }, { message: 'Now I am here.' }, { turn: 'Ilya', wrongFirst: 'Boris: still me' }] },
  'two-person': { state: () => { const s: any = initialState(); delete s.frame; s.participants = ['Boris', 'Ilya']; s.human = 'Deniz'; return s; },
    steps: [{ turn: 'Ilya' }, { message: 'Hi both.' }, { turn: 'Boris', run: { id: 'run', index: 1, count: 2, mode: 'alternate' }, wrongFirst: 'Ilya: wrong' }, { run: { id: 'run', index: 2, count: 2, mode: 'alternate' } }] },
  'human-collides-with-character': { state: () => { const s: any = initialState(); delete s.frame; s.human = 'Boris'; s.participants = ['Boris', 'Ilya', 'Rook']; return s; },
    steps: [{ message: 'I am Boris, the human.' }, { turn: 'Ilya', wrongFirst: 'Rook: wrong' }, { turn: 'Boris' }] },
};
export async function capture(root: string, name: string) {
  const bodies: string[] = []; let pending: string | undefined;
  const e = new Engine(new Store(root), async (_url, opts) => { bodies.push(String(opts?.body)); const wrong = pending; pending = undefined; return reply(wrong ?? `Reply ${bodies.length}.`); });
  const { state, steps } = scenarios[name];
  let b = e.create(name, state());
  for (const step of steps) {
    if (step.message) b = e.message(b.id, b.head, step.message);
    else { pending = step.wrongFirst; b = await e.turn(b.id, b.head, step.turn as any, step.run); }
  }
  return bodies;
}
