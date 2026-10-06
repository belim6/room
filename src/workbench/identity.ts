import { PERSONAS } from '../personas/personas';
import type { State, Message } from './engine';
// Identity compatibility contract: historical records are never rewritten; this reader interprets them.
export const LEGACY_NAMES = Object.keys(PERSONAS);
export const NARRATOR = 'Narrator';
export type SpeakerRef = { kind: 'person'; id: string } | { kind: 'human' } | { kind: 'narrator' } | { kind: 'unbound' };
export type Assembly = 'legacy-v1' | 'v2';
export const assemblyOf = (s: Pick<State, 'assemblyVersion'>): Assembly => s.assemblyVersion ?? 'legacy-v1';
// A legacy character key is its own label, scoped to its conversation family.
export const labelOf = (s: Pick<State, 'characters'>, person: string) => s.characters[person]?.label ?? person;
// Uniqueness comparison: NFC normalization plus case folding (toLowerCase; JavaScript has no full case fold).
export const labelKey = (label: string) => label.normalize('NFC').toLowerCase();
export function validateLabel(label: unknown): string {
  if (typeof label !== 'string' || label !== label.trim() || !label || [...label].length > 80) throw Error('A label must be 1–80 characters with no leading or trailing spaces');
  if (/\p{Cc}|\p{Zl}|\p{Zp}/u.test(label)) throw Error('A label must be a single line without control characters');
  if (label.includes(':')) throw Error('A label cannot contain ":" because transcripts use "Label: text"');
  return label;
}
export function validRef(ref: any): ref is SpeakerRef {
  return !!ref && typeof ref === 'object' && (ref.kind === 'person' ? typeof ref.id === 'string' && !!ref.id && Object.keys(ref).length === 2 : ['human', 'narrator', 'unbound'].includes(ref.kind) && Object.keys(ref).length === 1);
}
// Explicit speakerRef first. Legacy messages resolve only through this state's character map and their source;
// ambiguous or unknown attribution stays unbound, and free text is never read as a character ID.
export function resolveSpeaker(s: State, m: Message): SpeakerRef {
  if (m.speakerRef) return m.speakerRef;
  if (m.source === 'human') return { kind: 'human' };
  const person = LEGACY_NAMES.includes(m.speaker) && Object.prototype.hasOwnProperty.call(s.characters, m.speaker) ? m.speaker : null;
  if (m.source === 'generated') return person ? { kind: 'person', id: person } : { kind: 'unbound' };
  const human = m.speaker === s.human;
  return person && !human ? { kind: 'person', id: person } : human && !person ? { kind: 'human' } : { kind: 'unbound' };
}
export const speakerId = (s: State, m: Message) => { const r = resolveSpeaker(s, m); return r.kind === 'person' ? r.id : null; };
export const lastPerson = (s: State) => { for (let i = s.messages.length - 1; i >= 0; i--) { const p = speakerId(s, s.messages[i]); if (p) return p; } return null; };
// A narrator line never makes the human present; legacy messages without a ref fall back to the name match.
export const humanPresent = (s: State) => s.messages.some(m => m.speakerRef ? m.speakerRef.kind === 'human' : m.speaker === s.human);
export const labelFor = (s: State, ref: SpeakerRef, fallback?: string) => ref.kind === 'person' ? labelOf(s, ref.id) : ref.kind === 'human' ? s.human : ref.kind === 'narrator' ? NARRATOR : fallback;
// Validation roster: legacy-v1 keeps today's 8 names (inactive included, human excluded); v2 uses the full cast plus the human.
export const rosterOf = (s: State) => assemblyOf(s) === 'v2' ? [...new Set([...Object.keys(s.characters).map(p => labelOf(s, p)), s.human])] : [...LEGACY_NAMES];
export const resolvedMap = (s: State) => Object.fromEntries(s.messages.map(m => [m.id, resolveSpeaker(s, m)]));
