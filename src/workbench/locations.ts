import type { State, Message } from './engine';
import { assemblyOf, labelOf, labelKey, resolveSpeaker, type Provenance } from './identity';
// Locations (stage 1.6): who heard a message is decided once, when it is stamped, by IDs. Hiding happens only by
// leaving messages out of a person's history; display snapshots keep names as they were and never reach a model.
export interface Place { id: string; name: string }
export interface Locations { places: Place[]; at: Record<string, string> }
export interface Audience { place: string; present: string[]; display: { place: string; present: string[] } }
export interface Movement { from: string; to: string; movers: string[]; display: { from: string; to: string; movers: string[] } }
export const HUMAN = 'human';
const only = (o: any, keys: string[]) => !!o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).sort().join() === [...keys].sort().join();
export function validatePlaceName(name: unknown): string {
  if (typeof name !== 'string' || name !== name.trim() || !name || [...name].length > 40) throw Error('A place name must be 1–40 characters with no leading or trailing spaces');
  if (/\p{Cc}|\p{Zl}|\p{Zp}/u.test(name) || name.includes(':')) throw Error('A place name must be one line without ":"');
  return name;
}
export const placeOf = (s: State, place: string) => s.locations?.places.find(p => p.id === place);
export const placeName = (s: State, place: string) => placeOf(s, place)?.name ?? place;
export const whoLabel = (s: State, key: string) => key === HUMAN ? s.human : labelOf(s, key);
export const knownPlace = (s: State, place: unknown): place is string => typeof place === 'string' && !!placeOf(s, place);
// Active characters placed there, in participant order.
export const localCast = (s: State, place: string) => s.participants.filter(p => s.locations!.at[p] === place);
// present(place): active characters placed there, plus the human when placed there, whether or not they have spoken.
export const present = (s: State, place: string) => [...localCast(s, place), ...(s.locations!.at[HUMAN] === place ? [HUMAN] : [])];
export const snapshot = (s: State, place: string, ids: string[]): Audience => ({ place, present: [...ids], display: { place: placeName(s, place), present: ids.map(k => whoLabel(s, k)) } });
export const stamp = (s: State, place: string) => snapshot(s, place, present(s, place));
// The one visibility projection: public messages plus those the person was present for, in order.
export const visibleTo = (s: Pick<State, 'messages' | 'locations'>, person: string): Message[] => !s.locations ? s.messages : s.messages.filter(m => !m.audience || m.audience.present.includes(person));
export function visibility(s: State, person: string) {
  const seen = visibleTo(s, person);
  return { policy: 'audience-1' as const, person, place: s.locations!.at[person], hidden: s.messages.length - seen.length, visibleMessageIds: seen.map(m => m.id) };
}
// The latest line attributed to a person that was located in this place; public, human and narrator lines don't count.
export function localLastSpeaker(s: State, place: string, provenance?: Provenance) {
  for (let i = s.messages.length - 1; i >= 0; i--) {
    const m = s.messages[i]; if (m.audience?.place !== place) continue;
    const r = resolveSpeaker(s, m, provenance); if (r.kind === 'person') return r.id;
  }
  return null;
}
// Rotation visits places in order that have two active characters, or one plus the human.
export const rotationOrder = (s: State) => s.locations!.places.map(p => p.id).filter(p => { const n = localCast(s, p).length; return n >= 2 || (n === 1 && s.locations!.at[HUMAN] === p); });
export const joinNames = (names: string[]) => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
// Export/tag text, rendered from the stamped snapshots.
export function scopeTag(m: Message) {
  const tags: string[] = [];
  if (m.movement) tags.push(`[move: ${m.movement.display.movers.join(', ')} · ${m.movement.display.from} → ${m.movement.display.to}]`);
  if (m.audience) tags.push(`[${m.audience.display.place}: ${m.audience.display.present.join(', ') || 'nobody'}]`);
  return tags.join(' ');
}
const strings = (v: any, n?: number) => Array.isArray(v) && (n === undefined || v.length === n) && v.every(x => typeof x === 'string' && x.length <= 200);
export function validateLocations(s: State, previous?: State | null) {
  const L = s.locations;
  if (L === undefined) {
    if (previous?.locations) throw Error('Locations cannot be turned off in this release; private lines would become public');
    if (s.messages.some(m => m.audience !== undefined || m.movement !== undefined)) throw Error('Scoped messages need this room’s locations');
    return;
  }
  if (assemblyOf(s) !== 'v2') throw Error('Locations require v2 assembly');
  if (!only(L, ['places', 'at']) || !Array.isArray(L.places) || !L.places.length || L.places.length > 50) throw Error('Invalid locations: give one to 50 places and a placement');
  const ids = new Set<string>(), names = new Set<string>();
  for (const p of L.places) {
    if (!only(p, ['id', 'name']) || typeof p.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(p.id) || ids.has(p.id)) throw Error('Invalid place IDs');
    validatePlaceName(p.name); if (names.has(labelKey(p.name))) throw Error(`Two places are named ${p.name}`);
    ids.add(p.id); names.add(labelKey(p.name));
  }
  const people = Object.keys(s.characters);
  if (people.includes(HUMAN)) throw Error('A person ID collides with the human placement key');
  const keys = [...people, HUMAN];
  if (!L.at || typeof L.at !== 'object' || Array.isArray(L.at) || Object.keys(L.at).length !== keys.length || keys.some(k => !ids.has(L.at[k]))) throw Error('Every person, active or not, and you need a place');
  const prior = previous?.locations?.places.filter(p => !ids.has(p.id));
  if (prior?.length) throw Error(`Places cannot be removed in this release (${prior.map(p => p.name).join(', ')})`);
  const who = new Set(keys);
  for (const m of s.messages) {
    const a = m.audience, v = m.movement;
    if (a !== undefined && (!only(a, ['place', 'present', 'display']) || !ids.has(a.place) || !strings(a.present) || new Set(a.present).size !== a.present.length || a.present.some(k => !who.has(k))
      || !only(a.display, ['place', 'present']) || typeof a.display.place !== 'string' || !strings(a.display.present, a.present.length))) throw Error('Invalid message audience');
    if (v !== undefined && (!only(v, ['from', 'to', 'movers', 'display']) || !ids.has(v.from) || !ids.has(v.to) || v.from === v.to || !strings(v.movers) || !v.movers.length || new Set(v.movers).size !== v.movers.length || v.movers.some(k => !who.has(k))
      || !only(v.display, ['from', 'to', 'movers']) || typeof v.display.from !== 'string' || typeof v.display.to !== 'string' || !strings(v.display.movers, v.movers.length))) throw Error('Invalid movement record');
  }
}
// Explicit audience edit: who gains and who loses this line. Public is everyone in the cast plus you.
export function audienceChange(s: State, m: Message, next: Audience | null) {
  const everyone = [...Object.keys(s.characters), HUMAN], sees = (a?: Audience | null) => new Set(a ? a.present : everyone);
  const before = sees(m.audience), after = sees(next);
  return { before: m.audience ?? null, after: next, gained: everyone.filter(k => after.has(k) && !before.has(k)).map(k => whoLabel(s, k)), lost: everyone.filter(k => before.has(k) && !after.has(k)).map(k => whoLabel(s, k)) };
}
