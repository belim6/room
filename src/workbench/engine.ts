import { Store, clone, id } from './store';
import { generate, reasoningSwitchVerified, SIMULATED_REASONING_V1, DEFAULT_MODEL, type Provider } from './generation';
import { PERSONAS, type PersonaName } from '../personas/personas';
import { GLOBAL_SYSTEM } from '../modelRouter';
import { buildSpeakerInput, fillFrame, EMPTY_FRAME, DEFAULT_FRAME, type Frame } from '../speakerTurn';
import { assemblyOf, labelOf, labelKey, validateLabel, validRef, lastPerson, humanPresent, rosterOf, resolveSpeaker, generationProvenance, LEGACY_NAMES, NARRATOR, type SpeakerRef, type Assembly } from './identity';
import { shadowJev } from './jev';
import { getAttachments, attachmentTranscript, type ContentPart } from './attachments';
import { historyConfig, appendContent, assertPerspective, type HistoryConfig, type RequestMessage } from './history';
import { validateLocations, visibleTo, visibility, localCast, localLastSpeaker, stamp, snapshot, present, placeName, knownPlace, whoLabel, joinNames, validatePlaceName, audienceChange, HUMAN, type Locations, type Audience, type Movement } from './locations';

export interface VaultRef { item: string; revision: string }
// Legacy rooms key characters by name with no label; v2 rooms key people by UUID and keep the label as display text.
export interface Character { label?: string; prompt: string; situation?: string; memory: string; provider: Provider; model: string; temperature: number; reasoning?: 'default' | 'off' | 'simulated'; origin?: VaultRef }
// `speaker` is the label as written at the time (evidence, never rewritten); `speakerRef` is the identity.
export interface Message { id: string; speaker: string; speakerRef?: SpeakerRef; text: string; source: 'human' | 'generated' | 'imported' | 'edited' | 'template' | 'movement' | 'narration'; turnId?: string; checkpoint?: string; editedFrom?: string[]; attachments?: string[]; review?: string;
  audience?: Audience; movement?: Movement }
export type TemplateField = 'system' | 'frame' | 'flow';
export interface FieldProvenance { item: string; revision: string; value: unknown }
export interface State { system: string; participants: string[]; characters: Record<string, Character>;
  messages: Message[]; shadow: boolean; policy: 'protected' | 'observe'; human: string; frame?: Frame; flow?: 'random' | 'alternate'; assemblyVersion?: Assembly; assembly?: HistoryConfig; locations?: Locations;
  origin?: { template: VaultRef }; templateFields?: Partial<Record<TemplateField, FieldProvenance>> }
export interface Adoption { kind: 'persona' | 'template' | 'switch'; source?: VaultRef; person?: string; fields: string[]; replacedDiverged?: string[] }
export interface MessageChange { kind: 'delete-message' | 'restore-message' | 'replace-message' | 'audience-message'; message: Message; index: number; candidate?: string; judgment?: string }
export interface Revision { id: string; branch: string; parent: string | null; at: string; reason: string; state: State; change?: MessageChange; adoption?: Adoption }
export interface Branch { id: string; name: string; head: string; parent: string | null; fork: string | null; createdAt: string; comparison?: string; experiment?: string; trial?: string; workspace?: boolean }
export interface TrashEntry { id: string; branch: string; name: string; branches: string[]; deletedAt: string; restoredAt?: string }
const names = Object.keys(PERSONAS) as PersonaName[];
export function initialState(): State {
  return { frame: { ...EMPTY_FRAME }, system: GLOBAL_SYSTEM, participants: [...names], messages: [], shadow: false, policy: 'protected', human: 'Dennis',
    characters: Object.fromEntries(names.map(name => [name, { prompt: PERSONAS[name].systemPrompt,
      memory: '', provider: 'opengateway', model: DEFAULT_MODEL, temperature: 0.7 }])) as State['characters'] };
}
// A new room starts from scratch: v2 assembly, no cast, no room instructions, and the default framing, so a first turn
// with an empty transcript still sends an explicit opening line.
export function emptyRoomState(): State {
  return { frame: { ...DEFAULT_FRAME }, system: '', participants: [], characters: {}, messages: [], shadow: false, policy: 'protected', human: 'Dennis', assemblyVersion: 'v2' };
}
const isRef = (r: any) => !!r && typeof r === 'object' && typeof r.item === 'string' && !!r.item && typeof r.revision === 'string' && !!r.revision;
// Strict identity checks apply only to identities that are new or changed relative to `previous`; history stays readable.
export function validateState(s: State, previous?: State | null) {
  if (!s || typeof s.system !== 'string' || s.system.length > 100000 || typeof s.human !== 'string' || !s.human.trim() || s.human.length > 80) throw Error('Invalid shared instructions or human name');
  if (s.assemblyVersion !== undefined && !['legacy-v1','v2'].includes(s.assemblyVersion)) throw Error('Invalid assembly version');
  historyConfig(s.assemblyVersion,s.assembly);
  if (s.flow !== undefined && !['random','alternate'].includes(s.flow)) throw Error('Invalid flow');
  if (!s.characters || typeof s.characters !== 'object' || Array.isArray(s.characters)) throw Error('Invalid cast');
  const ids = Object.keys(s.characters), v2 = assemblyOf(s) === 'v2';
  if (!v2 && (ids.length !== names.length || names.some(n => !ids.includes(n)) || ids.some(n => s.characters[n]?.label !== undefined && s.characters[n].label !== n)))
    throw Error('This room uses legacy assembly. Adding a person or changing a label needs an explicit switch to v2.');
  if (!Array.isArray(s.participants) || new Set(s.participants).size !== s.participants.length || s.participants.some(p => !ids.includes(p))) throw Error('Choose valid participants');
  if (typeof s.shadow !== 'boolean' || !['protected','observe'].includes(s.policy)) throw Error('Invalid observation settings');
  for (const key of ids) {
    const c = s.characters[key], name = c && typeof c.label === 'string' ? c.label : key;
    if (!c || typeof c.prompt !== 'string' || typeof c.memory !== 'string' || !['together','opengateway','demo'].includes(c.provider) || typeof c.model !== 'string' || !c.model.trim() || c.model.length > 200 || !Number.isFinite(c.temperature) || c.temperature < 0 || c.temperature > 2 || (c.reasoning !== undefined && !['default','off','simulated'].includes(c.reasoning))
      || (c.label !== undefined && typeof c.label !== 'string') || (c.situation !== undefined && (typeof c.situation !== 'string' || c.situation.length > 20000)) || (c.origin !== undefined && !isRef(c.origin))) throw Error(`Invalid character settings: ${name}`);
    if ((c.reasoning === 'off' || c.reasoning === 'simulated') && !reasoningSwitchVerified(c.provider)) throw Error(`${name}: turning reasoning off is not verified for ${c.provider}`);
  }
  if (v2) {
    const humanChanged = !previous || previous.human !== s.human, key = new Map(ids.map(k => [k, labelKey(labelOf(s,k))]));
    for (const k of ids) {
      const changed = !previous?.characters?.[k] || labelOf(previous,k) !== labelOf(s,k);
      if (changed) {
        if (!LEGACY_NAMES.includes(k) && s.characters[k].label === undefined) throw Error('Every new person needs a label');
        validateLabel(labelOf(s,k));
        if (ids.some(o => o !== k && key.get(o) === key.get(k))) throw Error(`Another person in this room is already labeled ${labelOf(s,k)}`);
      }
      if ((changed || humanChanged) && key.get(k) === labelKey(s.human)) throw Error(`${labelOf(s,k)} is your name in this room. Choose another label.`);
    }
  }
  if (s.origin !== undefined && (!s.origin || !isRef(s.origin.template))) throw Error('Invalid room origin');
  if (s.templateFields !== undefined && (!s.templateFields || typeof s.templateFields !== 'object' || Object.entries(s.templateFields).some(([k,v]) => !['system','frame','flow'].includes(k) || !isRef(v)))) throw Error('Invalid template provenance');
  if (s.frame !== undefined && (!s.frame || typeof s.frame !== 'object' || Object.keys(s.frame).sort().join() !== 'context,identity,opening,turn' || Object.values(s.frame).some(v => typeof v !== 'string' || v.length > 20000))) throw Error('Invalid harness framing');
  if (!Array.isArray(s.messages) || s.messages.length > 10000 || s.messages.some(m => typeof m.id !== 'string' || typeof m.text !== 'string' || m.text.length > 100000 || typeof m.speaker !== 'string' || !m.speaker.trim() || m.speaker.length > 80)) throw Error('Invalid conversation');
  if (s.messages.some(m => m.speakerRef !== undefined && (!validRef(m.speakerRef) || (m.speakerRef.kind === 'person' && !ids.includes(m.speakerRef.id))))) throw Error('Invalid message attribution');
  validateLocations(s, previous);
  for(const m of s.messages)if(m.attachments!==undefined&&(!Array.isArray(m.attachments)||m.attachments.length>4||new Set(m.attachments).size!==m.attachments.length||m.attachments.some(a=>typeof a!=='string'||!/^[a-zA-Z0-9_-]+$/.test(a))))throw Error('Invalid message attachments');
}
// Back-and-forth needs exactly two active participants; otherwise the flow resets visibly, recorded in the revision reason.
export function normalizeFlow(s: State) {
  // With locations, back-and-forth is checked against the run's place when it starts.
  if (s.flow !== 'alternate' || s.participants.length === 2 || s.locations) return '';
  s.flow = 'random'; return ' · back-and-forth reset to random (it needs exactly two active participants)';
}
// Request assembly for one speaker. Legacy rooms keep their exact historical code paths; v2 orders the system message as
// persona prompt, situation, room instructions, retained memory, identity line, and always uses a frame.
export function assemble(store: Store, s: State, speaker: string, images = true) {
  const c = s.characters[speaker], v2 = assemblyOf(s) === 'v2', label = labelOf(s, speaker);
  const assembly=historyConfig(s.assemblyVersion,s.assembly), perspective=assembly.history==='perspective';
  if(perspective&&s.frame!==undefined&&(Object.keys(s.frame).sort().join()!==Object.keys(DEFAULT_FRAME).sort().join()||Object.entries(DEFAULT_FRAME).some(([k,v])=>s.frame![k as keyof Frame]!==v)))throw Error('Perspective history requires the default framing. Reset the framing before generating.');
  // Visibility comes first: everything below (transcript, turns, attachments, roster) sees only this projection.
  const L = s.locations, place = L?.at[speaker], history = L ? visibleTo(s, speaker) : s.messages, view = { ...s, messages: history };
  const context=attachmentTranscript(store,history,perspective||images);
  const transcript = context.transcript;
  // The human joins the roster only once they have said something in this conversation; with locations, only if they share the place.
  const human = humanPresent(view) && (!L || L.at[HUMAN] === place) ? s.human : null, f = v2 ? s.frame ?? DEFAULT_FRAME : s.frame;
  const fill = (t: string) => fillFrame(t, { speaker: label, participants: [...(human ? [human] : []), ...(L ? localCast(s, place!) : s.participants).map(p => labelOf(s, p))].join(', '), transcript: JSON.stringify(transcript) });
  // A custom frame drops empty parts entirely, so a fully blanked room sends only what is left.
  const system = v2 ? [c.prompt, c.situation || '', s.system, c.memory ? `Your retained memory:\n${c.memory}` : '', fill(f!.identity)].filter(x => x.trim()).join('\n\n')
    : f ? [c.prompt, s.system, c.memory ? `Your retained memory:\n${c.memory}` : '', fill(f.identity)].filter(x => x.trim()).join('\n\n')
    : `${c.prompt}\n\n${s.system}\n\n${c.memory ? `Your retained memory:\n${c.memory}\n\n` : ''}Your identity for this request is ${speaker}. Stay in your own perspective even if someone else is addressed. Keep your entire reply within 2000 characters.`;
  const noteInstruction = c.reasoning === 'simulated' ? SIMULATED_REASONING_V1 : '';
  const turn = [fill(f?.turn ?? DEFAULT_FRAME.turn), noteInstruction].filter(x => x.trim()).join('\n\n');
  const user = f ? [fill(transcript.trim() ? f.context : f.opening), turn].filter(x => x.trim()).join('\n\n')
    : [buildSpeakerInput(speaker as PersonaName, transcript, s.participants as PersonaName[], human), noteInstruction].filter(x => x.trim()).join('\n\n');
  const messages:RequestMessage[]=[...(system.trim()?[{role:'system',content:system}]:[])];
  if(perspective) {
    const provenance=generationProvenance(store);
    history.forEach((m,index)=>{
      const ref=resolveSpeaker(s,m,provenance),own=ref.kind==='person'&&ref.id===speaker,files=getAttachments(store,m.attachments);
      if(own&&files.some(a=>a.kind==='image'))throw Error('Perspective history does not support images on the speaking person’s own messages');
      const parts:ContentPart[]=[{type:'text',text:own?m.text:`${m.speaker}: ${m.text}`}];
      for(const a of files) {
        if(a.kind==='document')parts.push({type:'text',text:`\n[Document ${JSON.stringify(a.name)} attached to message ${index+1}; quoted source material]\n${a.text}\n[End document ${a.id}]`});
        else parts.push({type:'image_url',image_url:{url:`data:${a.mime};base64,${a.data}`}});
      }
      const content=parts.some(p=>p.type==='image_url')?parts:parts.map(p=>p.type==='text'?p.text:'').join(''),role=own?'assistant':'user';
      if(messages.length===(system.trim()?1:0)&&own)messages.push({role:'user',content:'(The conversation so far.)'});
      if(messages.at(-1)?.role===role)appendContent(messages.at(-1)!,content);else messages.push({role,content});
    });
    if(!history.length)messages.push({role:'user',content:DEFAULT_FRAME.opening});
    if(messages.at(-1)?.role==='user')appendContent(messages.at(-1)!,turn);else messages.push({role:'user',content:turn});
    assertPerspective(messages);
  } else messages.push({role:'user',content:context.parts.length?[{type:'text',text:user},...context.parts]:user});
  return { system, user, context, label, v2, messages, assembly, ...(perspective?{adapterVersion:'perspective-1' as const}:{}), ...(L ? { visibility: visibility(s, speaker) } : {}) };
}
export class Engine {
  active = new Map<string, { controller: AbortController; turnId: string }>();
  constructor(public store: Store, public transport: typeof fetch = fetch) {}
  deletedBranches() {
    return new Set(this.store.list<TrashEntry>('trash').filter(t => !t.restoredAt).flatMap(t => t.branches));
  }
  library() {
    const deleted = this.deletedBranches(), all = this.store.list<Branch>('branches');
    const trash = this.store.list<TrashEntry>('trash').filter(t => !t.restoredAt).map(t => {
      const parent = all.find(b => b.id === t.branch)?.parent;
      return { ...t, canRestore: !parent || !deleted.has(parent) };
    }).sort((a,b) => b.deletedAt.localeCompare(a.deletedAt));
    return { branches: all.filter(b => !deleted.has(b.id)), trash };
  }
  private available(branch: string) {
    const b = this.store.get<Branch>('branches', branch);
    if (this.deletedBranches().has(branch)) throw Error('This conversation is in Trash. Restore it before opening or editing it.');
    return b;
  }
  read(branch: string) { const b = this.available(branch); return { ...b, revision: this.store.get<Revision>('revisions', b.head) }; }
  trash(branch: string, expected: string) {
    const b = this.available(branch);
    if (b.head !== expected) throw Error('This conversation changed. Reload before deleting it.');
    const all = this.store.list<Branch>('branches'), descendants = new Set([branch]);
    let size: number;
    do { size = descendants.size; for (const candidate of all) if (candidate.parent && descendants.has(candidate.parent)) descendants.add(candidate.id); } while (size !== descendants.size);
    if ([...descendants].some(key => this.active.has(key))) throw Error('Stop generation in this conversation and its branches before deleting it.');
    const deleted = this.deletedBranches();
    const entry: TrashEntry = { id: id(), branch, name: b.name, branches: [...descendants].filter(key => !deleted.has(key)), deletedAt: new Date().toISOString() };
    // One atomic record hides the whole subtree; history and attempt files stay untouched.
    this.store.put('trash', entry.id, entry);
    return entry;
  }
  restore(key: string) {
    const entry = this.store.get<TrashEntry>('trash', key);
    if (!entry.restoredAt) {
      const b = this.store.get<Branch>('branches', entry.branch);
      if (b.parent && this.deletedBranches().has(b.parent)) throw Error('Restore the parent conversation from Trash first.');
      this.store.put('trash', key, { ...entry, restoredAt: new Date().toISOString() });
    }
    return this.read(entry.branch);
  }
  create(name = 'Untitled room', state = initialState(), parent: string | null = null, fork: string | null = null, comparison?: string, experiment?: { experiment: string; trial?: string; workspace?: boolean }, reason?: string) {
    state = clone(state); const note = normalizeFlow(state);
    validateState(state, fork ? this.store.get<Revision>('revisions', fork).state : null);
    for(const m of state.messages) getAttachments(this.store,m.attachments);
    if (parent) comparison = this.available(parent).comparison;
    const branch: Branch = { id: id(), name: name.slice(0, 120), head: '', parent, fork, ...(comparison ? { comparison } : {}), ...experiment, createdAt: new Date().toISOString() };
    const revision: Revision = { id: id(), branch: branch.id, parent: fork, at: new Date().toISOString(), reason: (reason || (parent ? 'Branch created' : experiment?.workspace ? 'Experiment workspace created' : comparison ? 'Comparison snapshot created' : 'Room created')) + note, state };
    branch.head = revision.id; this.store.put('revisions', revision.id, revision); this.store.put('branches', branch.id, branch);
    return this.read(branch.id);
  }
  commit(branchId: string, expected: string, state: State, reason: string, change?: MessageChange, adoption?: Adoption) {
    state = clone(state); reason += normalizeFlow(state);
    const b = this.available(branchId);
    validateState(state, this.store.get<Revision>('revisions', b.head).state);
    for(const m of state.messages) getAttachments(this.store,m.attachments);
    if (b.head !== expected) throw Error('This branch changed. Reload before saving your edit.');
    const revision: Revision = { id: id(), branch: branchId, parent: b.head, at: new Date().toISOString(), reason, state, ...(change ? { change: clone(change) } : {}), ...(adoption ? { adoption: clone(adoption) } : {}) };
    this.store.put('revisions', revision.id, revision); b.head = revision.id; this.store.put('branches', b.id, b);
    return this.read(b.id);
  }
  checkpoint(branchId: string, messageId: string) {
    const b = this.read(branchId);
    const index = b.revision.state.messages.findIndex(m => m.id === messageId);
    if (index < 0) throw Error('Message no longer exists');
    const prefix = JSON.stringify(b.revision.state.messages.slice(0,index + 1));
    let found = b.revision;
    let cursor: string | null = b.head;
    while (cursor) {
      const revision: Revision = this.store.get<Revision>('revisions',cursor);
      if (JSON.stringify(revision.state.messages.slice(0,index + 1)) === prefix) found = revision;
      cursor = revision.parent;
    }
    return { revision:found, index };
  }
  fork(branchId: string, revisionId: string, name: string, messageId?: string) {
    if (messageId) {
      const { revision, index } = this.checkpoint(branchId,messageId);
      const state = clone(revision.state);
      state.messages = state.messages.slice(0,index + 1);
      return this.create(name || 'Alternate continuation',state,branchId,revision.id);
    }
    // Only reachable ancestors/checkpoints may be used as a fork source.
    let cursor: string | null = this.read(branchId).head;
    while (cursor && cursor !== revisionId) cursor = this.store.get<Revision>('revisions', cursor).parent;
    if (!cursor) throw Error('That revision is not an ancestor of this branch');
    const source = this.store.get<Revision>('revisions', revisionId);
    return this.create(name || 'Alternate continuation', source.state, branchId, revisionId);
  }
  message(branchId: string, expected: string, text: string, attachments?: string[]) {
    const files=getAttachments(this.store,attachments);
    if (typeof text!=='string' || (!text.trim()&&!files.length) || text.length > 20000) throw Error('Write a message under 20,000 characters or attach a file');
    const b = this.read(branchId); const s = clone(b.revision.state);
    const next = id();
    // Legacy rooms keep their message shape; v2 rooms attribute every message explicitly.
    s.messages.push({ id: next, speaker: s.human, ...(assemblyOf(s) === 'v2' ? { speakerRef: { kind: 'human' as const } } : {}), text: text.trim(), source: 'human', ...(files.length?{attachments:files.map(a=>a.id)}:{}),
      ...(s.locations ? { audience: stamp(s, s.locations.at[HUMAN]) } : {}) });
    const result = this.commit(branchId, expected, s, 'Human message');
    return result;
  }
  // A narrator line: one place (stamped with who is there now) or public. It never makes anyone present.
  narrate(branchId: string, expected: string, text: unknown, place: unknown) {
    const s = clone(this.read(branchId).revision.state);
    if (assemblyOf(s) !== 'v2') throw Error('Narration needs v2 assembly');
    if (typeof text !== 'string' || !text.trim() || text.length > 20000) throw Error('Write narration under 20,000 characters');
    // A missing place is never read as public: only an explicit null is.
    if (place === undefined) throw Error('Choose a place or public (null) for this narration');
    if (place !== null && !knownPlace(s, place)) throw Error(s.locations ? 'Choose a place or public for this narration' : 'This room has no locations; narration is public');
    s.messages.push({ id: id(), speaker: NARRATOR, speakerRef: { kind: 'narrator' }, text: text.trim(), source: 'narration', ...(place !== null ? { audience: stamp(s, place as string) } : {}) });
    return this.commit(branchId, expected, s, place !== null ? `Narration in ${placeName(s, place as string)}` : 'Narration');
  }
  // Move: one origin, one destination (existing, or created in the same revision). Computed from the frozen pre-move state.
  planMove(state: State, input: any) {
    const s = clone(state), L = s.locations;
    if (!L) throw Error('This room has no locations');
    const movers = input?.movers;
    if (!Array.isArray(movers) || !movers.length || new Set(movers).size !== movers.length) throw Error('Choose who moves');
    for (const k of movers) if (k !== HUMAN && !s.participants.includes(k)) throw Error(s.characters[k] ? `${labelOf(s, k)} is inactive; inactive people change place only when they rejoin` : 'Unknown mover');
    const from = L.at[movers[0]];
    if (movers.some((k: string) => L.at[k] !== from)) throw Error('Everyone moving together must start in the same place');
    let to = input.to;
    if (input.newPlace !== undefined) {
      if (to !== undefined) throw Error('Choose an existing place or a new one, not both');
      const name = validatePlaceName(typeof input.newPlace === 'string' ? input.newPlace.trim() : input.newPlace);
      if (L.places.some(p => labelKey(p.name) === labelKey(name))) throw Error(`There is already a place named ${name}`);
      to = id(); L.places.push({ id: to, name });
    } else if (!knownPlace(s, to)) throw Error('Choose where they go');
    if (to === from) throw Error(`${joinNames(movers.map((k: string) => whoLabel(s, k)))} ${movers.length === 1 ? 'is' : 'are'} already in ${placeName(s, from)}`);
    const names = movers.map((k: string) => whoLabel(s, k)), witnesses = [...new Set([...present(s, from), ...present(s, to)])];
    const text = input.text === undefined || input.text === '' ? `${joinNames(names)} ${movers.length === 1 ? 'goes' : 'go'} to ${placeName(s, to)}.` : input.text;
    if (typeof text !== 'string' || !text.trim() || text.length > 20000) throw Error('Write the movement line under 20,000 characters');
    const message: Message = { id: id(), speaker: NARRATOR, speakerRef: { kind: 'narrator' }, text: text.trim(), source: 'movement', audience: snapshot(s, to, witnesses),
      movement: { from, to, movers: [...movers], display: { from: placeName(s, from), to: placeName(s, to), movers: names } } };
    for (const k of movers) L.at[k] = to;
    s.messages.push(message);
    return { state: s, message };
  }
  move(branchId: string, expected: string, input: any) {
    const plan = this.planMove(this.read(branchId).revision.state, input), m = plan.message.movement!;
    return this.commit(branchId, expected, plan.state, `Moved ${joinNames(m.display.movers)} from ${m.display.from} to ${m.display.to}`);
  }
  // Explicit audience edit: a new line object with a fresh snapshot; text, attribution and movement stay as they were.
  planAudience(state: State, messageId: string, input: unknown) {
    const s = clone(state), index = s.messages.findIndex(m => m.id === messageId), everyone = [...Object.keys(s.characters), HUMAN];
    if (!s.locations) throw Error('This room has no locations');
    if (index < 0) throw Error('Message no longer exists');
    if (input === undefined) throw Error('Choose who heard this line: a place and its listeners, or public (null)');
    let next: Audience | null = null;
    if (input !== null) {
      const a = input as any;
      if (!a || typeof a !== 'object' || Object.keys(a).sort().join() !== 'place,present' || !knownPlace(s, a.place) || !Array.isArray(a.present) || new Set(a.present).size !== a.present.length || a.present.some((k: unknown) => typeof k !== 'string' || !everyone.includes(k))) throw Error('Choose a place and who heard this line, or public');
      next = snapshot(s, a.place, everyone.filter(k => a.present.includes(k)));
    }
    const previous = s.messages[index], key = (a?: Audience | null) => JSON.stringify(a ? { place: a.place, present: [...a.present].sort() } : null);
    if (key(previous.audience) === key(next)) throw Error('That is already who heard this line');
    const { audience: _old, ...rest } = previous;
    s.messages[index] = { ...rest, speakerRef: resolveSpeaker(s, previous, generationProvenance(this.store)), id: id(), source: 'edited', editedFrom: [previous.id, ...(previous.editedFrom || [])], ...(next ? { audience: next } : {}) };
    return { state: s, index, previous, change: audienceChange(s, previous, next) };
  }
  setAudience(branchId: string, expected: string, messageId: string, input: unknown) {
    if (this.active.has(branchId)) throw Error('Stop generation before changing who heard a line.');
    const plan = this.planAudience(this.read(branchId).revision.state, messageId, input);
    return this.commit(branchId, expected, plan.state, plan.change.after ? `Audience edited: ${plan.change.after.display.place}` : 'Audience edited: made public', { kind: 'audience-message', message: plan.previous, index: plan.index });
  }
  deleteMessage(branchId: string, expected: string, messageId: string) {
    if (this.active.has(branchId)) throw Error('Stop generation before deleting a message.');
    const b = this.read(branchId), state = clone(b.revision.state);
    const index = state.messages.findIndex(m => m.id === messageId);
    if (index < 0) throw Error('Message no longer exists');
    const [message] = state.messages.splice(index,1);
    return this.commit(branchId,expected,state,'Message deleted',{kind:'delete-message',message,index});
  }
  restoreMessage(branchId: string, expected: string, deletion: string) {
    if (this.active.has(branchId)) throw Error('Stop generation before restoring a message.');
    const b = this.read(branchId), state = clone(b.revision.state);
    let cursor: string | null = b.head;
    while (cursor && cursor !== deletion) cursor = this.store.get<Revision>('revisions',cursor).parent;
    if (!cursor) throw Error('That deletion does not belong to this conversation');
    const revision = this.store.get<Revision>('revisions',cursor), change = revision.change;
    if (change?.kind !== 'delete-message' || !revision.parent) throw Error('Invalid message deletion');
    if (state.messages.some(m => m.id === change.message.id)) throw Error('This message is already present');
    const original = this.store.get<Revision>('revisions',revision.parent).state.messages;
    const next = original.slice(change.index+1).find(m => state.messages.some(current => current.id === m.id));
    const previous = original.slice(0,change.index).reverse().find(m => state.messages.some(current => current.id === m.id));
    const index = next ? state.messages.findIndex(m => m.id === next.id) : previous ? state.messages.findIndex(m => m.id === previous.id)+1 : Math.min(change.index,state.messages.length);
    state.messages.splice(index,0,clone(change.message));
    return this.commit(branchId,expected,state,'Message restored',{kind:'restore-message',message:change.message,index});
  }
  retcon(branchId: string, expected: string, messageId: string, text: string, mode: string, memory: string) {
    if (this.active.has(branchId)) throw Error('Stop generation before retconning');
    if (!['keep','regenerate'].includes(mode) || !['restore','keep'].includes(memory)) throw Error('Choose retcon and memory modes');
    const b = this.read(branchId); if (b.head !== expected) throw Error('Branch changed; reload first');
    const index = b.revision.state.messages.findIndex(m => m.id === messageId);
    if (index < 0) throw Error('Message no longer exists');
    const historical = this.checkpoint(branchId,messageId).revision;
    // Regeneration uses the entire historical state, not future settings.
    // The target state's roster decides who exists and participates; memory then follows identity from the chosen source.
    let s = clone(mode === 'regenerate' ? historical.state : b.revision.state);
    // Regenerate restores the historical placement; places created since stay (they can't be removed), with no one in them.
    if (mode === 'regenerate' && b.revision.state.locations) {
      if (!s.locations) throw Error('This line predates locations in this room. Regenerating from it would turn locations off, which this release does not support. Keep later messages, or branch from that point.');
      s.locations.places.push(...clone(b.revision.state.locations.places.filter(p => !s.locations!.places.some(h => h.id === p.id))));
    }
    const source = (memory === 'restore' ? historical : b.revision).state;
    for (const person of Object.keys(s.characters)) if (Object.prototype.hasOwnProperty.call(source.characters, person)) s.characters[person].memory = source.characters[person].memory;
    if (mode === 'regenerate') s.messages = s.messages.slice(0, index + 1);
    // A retconned line carries its resolved attribution explicitly, so losing source 'generated'/'human' can't lose who said it.
    if (text.trim()) s.messages[index] = { ...s.messages[index], speakerRef: resolveSpeaker(s, s.messages[index], generationProvenance(this.store)), id: id(), text, source: 'edited', editedFrom: [s.messages[index].id, ...(s.messages[index].editedFrom || [])] };
    else s.messages.splice(index, 1);
    const fork = this.commit(b.id, expected, s, 'History retconned');
    this.store.add('edits', { branch: fork.id, sourceRevision: b.head, messageId, text, mode, memory, at: new Date().toISOString() });
    return fork;
  }
  cancel(branch: string) { this.active.get(branch)?.controller.abort(); }
  async turn(branchId: string, expected: string, forced?: string, run?: { id: string; index: number; count: number; mode?: 'alternate' }, experiment?: { turnId: string }, preset?: { turnId: string }, where?: { place: string; policy?: 'place' | 'rotate'; cursor?: number }) {
    if (this.active.has(branchId)) throw Error('A turn is already running in this branch');
    const b = this.read(branchId);
    if (b.head !== expected) throw Error('Branch changed; reload before generating');
    const s = clone(b.revision.state);
    if (!s.participants.length) throw Error('Add a person to this room before generating');
    if (forced && !s.participants.includes(forced)) throw Error('Selected character is not participating');
    // With locations every turn happens in one concrete place: only the active characters there are eligible.
    const L = s.locations, place = where?.place;
    if (!L && where !== undefined) throw Error('This room has no locations');
    if (L && !knownPlace(s, place)) throw Error('Choose the place this turn happens in');
    const local = L ? localCast(s, place!) : s.participants;
    if (!local.length) throw Error(`Nobody who can speak is in ${placeName(s, place!)}`);
    if (L && forced && !local.includes(forced)) throw Error(`${labelOf(s, forced)} is not in ${placeName(s, place!)}`);
    // Back-and-forth: after the opening pick, the only eligible speaker is whichever of the two didn't speak last.
    if (run?.mode === 'alternate' && (local.length !== 2 || (forced && run.index > 1))) throw Error(L ? `Back-and-forth needs exactly two characters in ${placeName(s, place!)} and no fixed speaker after the first turn` : 'Back-and-forth needs exactly two participants and no fixed speaker after the first turn');
    const last = L ? localLastSpeaker(s, place!, generationProvenance(this.store)) : lastPerson(s, generationProvenance(this.store));
    const eligible = local.filter(p => p !== last);
    const pool = eligible.length ? eligible : local;
    const speaker = forced || pool[Math.floor(Math.random() * pool.length)];
    const turnId = experiment?.turnId || preset?.turnId || id(); const controller = new AbortController();
    this.active.set(branchId, { controller, turnId });
    this.store.put('selections', turnId, { id: turnId, branch: branchId, revision: b.head,
      at: new Date().toISOString(), // One operator pick repeated across a multi-turn run is a single decision: only its first turn is 'forced'.
      method: forced ? (!experiment && run && run.index > 1 ? 'locked' : 'forced') : 'random', run: run ?? null,
      eligible: forced ? local : pool, chosen: speaker, ...(L ? { place, placePolicy: where!.policy ?? 'place', ...(where!.cursor !== undefined ? { cursor: where!.cursor } : {}) } : {}) });
    try {
      // Validate file inputs before launching any paid observation. Jev receives text and image filenames only.
      const c = s.characters[speaker], { user, context, label, v2, messages, assembly, adapterVersion, visibility: seen } = assemble(this.store, s, speaker);
      if (!user.trim() && !context.parts.length) throw Error('Nothing to send: the assembled user message is empty. Include {transcript} in the conversation header, or add an opening instruction for an empty conversation.');
      if (s.shadow) void shadowJev(this.store,s,branchId,b.head,turnId,this.transport,speaker).catch(error=>console.error('Jev persistence error:',error.message));
      const result = await generate({ provider: c.provider, model: c.model, temperature: c.temperature, reasoning: c.reasoning,
        personId: speaker, labelAtDispatch: label, validationRoster: rosterOf(s), assemblyVersion: assemblyOf(s), ...(c.origin ? { origin: c.origin } : {}),
        messages, ...(v2?{assembly}:{}), adapterVersion, ...(seen ? { visibility: seen } : {}), attachments: context.attachments, branch: branchId, revision: b.head, turnId,
        policy: s.policy, signal: controller.signal }, this.store, this.transport);
      if (controller.signal.aborted || this.read(branchId).head !== b.head) {
        this.store.put('turns', turnId, { id: turnId, branch: branchId, status: controller.signal.aborted ? 'canceled' : 'detached', attempts: result.attempts, ...(run ? { run: run.id } : {}) });
        return this.read(branchId);
      }
      // Stamped from the dispatch-time state; a reply that comes back after a move has already been detached above.
      s.messages.push({ id: id(), speaker: label, ...(v2 ? { speakerRef: { kind: 'person' as const, id: speaker } } : {}), text: result.text, source: 'generated', turnId, ...(L ? { audience: stamp(s, place!) } : {}) });
      // Memory updates are manual in this release. Proposed notes remain in the attempt.
      const next = this.commit(branchId, b.head, s, `${label} replied`);
      this.store.put('turns', turnId, { id: turnId, branch: branchId, status: 'attached', revision: next.head, attempts: result.attempts, ...(run ? { run: run.id } : {}) });
      return next;
    } catch (e: any) {
      this.store.put('turns', turnId, { id: turnId, branch: branchId, status: controller.signal.aborted ? 'canceled' : 'failed', error: e.message, ...(run ? { run: run.id } : {}) });
      throw e;
    } finally { this.active.delete(branchId); }
  }
}
