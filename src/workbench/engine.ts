import { Store, clone, id } from './store';
import { generate, reasoningSwitchVerified, DEFAULT_MODEL, type Provider } from './generation';
import { PERSONAS, type PersonaName } from '../personas/personas';
import { GLOBAL_SYSTEM } from '../modelRouter';
import { buildSpeakerInput, fillFrame, EMPTY_FRAME, DEFAULT_FRAME, type Frame } from '../speakerTurn';
import { assemblyOf, labelOf, labelKey, validateLabel, validRef, lastPerson, humanPresent, rosterOf, resolveSpeaker, generationProvenance, LEGACY_NAMES, type SpeakerRef, type Assembly } from './identity';
import { shadowJev } from './jev';
import { getAttachments, attachmentTranscript } from './attachments';

export interface VaultRef { item: string; revision: string }
// Legacy rooms key characters by name with no label; v2 rooms key people by UUID and keep the label as display text.
export interface Character { label?: string; prompt: string; situation?: string; memory: string; provider: Provider; model: string; temperature: number; reasoning?: 'default' | 'off'; origin?: VaultRef }
// `speaker` is the label as written at the time (evidence, never rewritten); `speakerRef` is the identity.
export interface Message { id: string; speaker: string; speakerRef?: SpeakerRef; text: string; source: 'human' | 'generated' | 'imported' | 'edited' | 'template'; turnId?: string; checkpoint?: string; editedFrom?: string[]; attachments?: string[]; review?: string }
export type TemplateField = 'system' | 'frame' | 'flow';
export interface FieldProvenance { item: string; revision: string; value: unknown }
export interface State { system: string; participants: string[]; characters: Record<string, Character>;
  messages: Message[]; shadow: boolean; policy: 'protected' | 'observe'; human: string; frame?: Frame; flow?: 'random' | 'alternate'; assemblyVersion?: Assembly;
  origin?: { template: VaultRef }; templateFields?: Partial<Record<TemplateField, FieldProvenance>> }
export interface Adoption { kind: 'persona' | 'template' | 'switch'; source?: VaultRef; person?: string; fields: string[]; replacedDiverged?: string[] }
export interface MessageChange { kind: 'delete-message' | 'restore-message' | 'replace-message'; message: Message; index: number; candidate?: string; judgment?: string }
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
  if (s.flow !== undefined && !['random','alternate'].includes(s.flow)) throw Error('Invalid flow');
  if (!s.characters || typeof s.characters !== 'object' || Array.isArray(s.characters)) throw Error('Invalid cast');
  const ids = Object.keys(s.characters), v2 = assemblyOf(s) === 'v2';
  if (!v2 && (ids.length !== names.length || names.some(n => !ids.includes(n)) || ids.some(n => s.characters[n]?.label !== undefined && s.characters[n].label !== n)))
    throw Error('This room uses legacy assembly. Adding a person or changing a label needs an explicit switch to v2.');
  if (!Array.isArray(s.participants) || new Set(s.participants).size !== s.participants.length || s.participants.some(p => !ids.includes(p))) throw Error('Choose valid participants');
  if (typeof s.shadow !== 'boolean' || !['protected','observe'].includes(s.policy)) throw Error('Invalid observation settings');
  for (const key of ids) {
    const c = s.characters[key], name = c && typeof c.label === 'string' ? c.label : key;
    if (!c || typeof c.prompt !== 'string' || typeof c.memory !== 'string' || !['together','opengateway','demo'].includes(c.provider) || typeof c.model !== 'string' || !c.model.trim() || c.model.length > 200 || !Number.isFinite(c.temperature) || c.temperature < 0 || c.temperature > 2 || (c.reasoning !== undefined && !['default','off'].includes(c.reasoning))
      || (c.label !== undefined && typeof c.label !== 'string') || (c.situation !== undefined && (typeof c.situation !== 'string' || c.situation.length > 20000)) || (c.origin !== undefined && !isRef(c.origin))) throw Error(`Invalid character settings: ${name}`);
    if (c.reasoning === 'off' && !reasoningSwitchVerified(c.provider)) throw Error(`${name}: turning reasoning off is not verified for ${c.provider}`);
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
  for(const m of s.messages)if(m.attachments!==undefined&&(!Array.isArray(m.attachments)||m.attachments.length>4||new Set(m.attachments).size!==m.attachments.length||m.attachments.some(a=>typeof a!=='string'||!/^[a-zA-Z0-9_-]+$/.test(a))))throw Error('Invalid message attachments');
}
// Back-and-forth needs exactly two active participants; otherwise the flow resets visibly, recorded in the revision reason.
export function normalizeFlow(s: State) {
  if (s.flow !== 'alternate' || s.participants.length === 2) return '';
  s.flow = 'random'; return ' · back-and-forth reset to random (it needs exactly two active participants)';
}
// Request assembly for one speaker. Legacy rooms keep their exact historical code paths; v2 orders the system message as
// persona prompt, situation, room instructions, retained memory, identity line, and always uses a frame.
export function assemble(store: Store, s: State, speaker: string, images = true) {
  const c = s.characters[speaker], v2 = assemblyOf(s) === 'v2', label = labelOf(s, speaker);
  const context=attachmentTranscript(store,s.messages,images);
  const transcript = context.transcript;
  // The human joins the roster only once they have said something in this conversation.
  const human = humanPresent(s) ? s.human : null, f = v2 ? s.frame ?? DEFAULT_FRAME : s.frame;
  const fill = (t: string) => fillFrame(t, { speaker: label, participants: [...(human ? [human] : []), ...s.participants.map(p => labelOf(s, p))].join(', '), transcript: JSON.stringify(transcript) });
  // A custom frame drops empty parts entirely, so a fully blanked room sends only what is left.
  const system = v2 ? [c.prompt, c.situation || '', s.system, c.memory ? `Your retained memory:\n${c.memory}` : '', fill(f!.identity)].filter(x => x.trim()).join('\n\n')
    : f ? [c.prompt, s.system, c.memory ? `Your retained memory:\n${c.memory}` : '', fill(f.identity)].filter(x => x.trim()).join('\n\n')
    : `${c.prompt}\n\n${s.system}\n\n${c.memory ? `Your retained memory:\n${c.memory}\n\n` : ''}Your identity for this request is ${speaker}. Stay in your own perspective even if someone else is addressed. Keep your entire reply within 2000 characters.`;
  const user = f ? [fill(transcript.trim() ? f.context : f.opening), fill(f.turn)].filter(x => x.trim()).join('\n\n')
    : buildSpeakerInput(speaker as PersonaName, transcript, s.participants as PersonaName[], human);
  return { system, user, context, label, v2 };
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
    s.messages.push({ id: next, speaker: s.human, ...(assemblyOf(s) === 'v2' ? { speakerRef: { kind: 'human' as const } } : {}), text: text.trim(), source: 'human', ...(files.length?{attachments:files.map(a=>a.id)}:{}) });
    const result = this.commit(branchId, expected, s, 'Human message');
    return result;
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
  async turn(branchId: string, expected: string, forced?: string, run?: { id: string; index: number; count: number; mode?: 'alternate' }, experiment?: { turnId: string }, preset?: { turnId: string }) {
    if (this.active.has(branchId)) throw Error('A turn is already running in this branch');
    const b = this.read(branchId);
    if (b.head !== expected) throw Error('Branch changed; reload before generating');
    const s = clone(b.revision.state);
    if (!s.participants.length) throw Error('Add a person to this room before generating');
    if (forced && !s.participants.includes(forced)) throw Error('Selected character is not participating');
    // Back-and-forth: after the opening pick, the only eligible speaker is whichever of the two didn't speak last.
    if (run?.mode === 'alternate' && (s.participants.length !== 2 || (forced && run.index > 1))) throw Error('Back-and-forth needs exactly two participants and no fixed speaker after the first turn');
    const last = lastPerson(s, generationProvenance(this.store));
    const eligible = s.participants.filter(p => p !== last);
    const pool = eligible.length ? eligible : s.participants;
    const speaker = forced || pool[Math.floor(Math.random() * pool.length)];
    const turnId = experiment?.turnId || preset?.turnId || id(); const controller = new AbortController();
    this.active.set(branchId, { controller, turnId });
    this.store.put('selections', turnId, { id: turnId, branch: branchId, revision: b.head,
      at: new Date().toISOString(), // One operator pick repeated across a multi-turn run is a single decision: only its first turn is 'forced'.
      method: forced ? (!experiment && run && run.index > 1 ? 'locked' : 'forced') : 'random', run: run ?? null,
      eligible: forced ? s.participants : pool, chosen: speaker });
    try {
      // Validate file inputs before launching any paid observation. Jev receives text and image filenames only.
      const c = s.characters[speaker], { system, user, context, label, v2 } = assemble(this.store, s, speaker);
      if (!user.trim() && !context.parts.length) throw Error('Nothing to send: the assembled user message is empty. Include {transcript} in the conversation header, or add an opening instruction for an empty conversation.');
      if (s.shadow) void shadowJev(this.store,s,branchId,b.head,turnId,this.transport).catch(error=>console.error('Jev persistence error:',error.message));
      const result = await generate({ provider: c.provider, model: c.model, temperature: c.temperature, reasoning: c.reasoning,
        personId: speaker, labelAtDispatch: label, validationRoster: rosterOf(s), assemblyVersion: assemblyOf(s), ...(c.origin ? { origin: c.origin } : {}),
        messages: [...(system.trim() ? [{ role: 'system' as const, content: system }] : []), { role: 'user', content: context.parts.length ? [{type:'text',text:user},...context.parts] : user }], attachments: context.attachments, branch: branchId, revision: b.head, turnId,
        policy: s.policy, signal: controller.signal }, this.store, this.transport);
      if (controller.signal.aborted || this.read(branchId).head !== b.head) {
        this.store.put('turns', turnId, { id: turnId, branch: branchId, status: controller.signal.aborted ? 'canceled' : 'detached', attempts: result.attempts, ...(run ? { run: run.id } : {}) });
        return this.read(branchId);
      }
      s.messages.push({ id: id(), speaker: label, ...(v2 ? { speakerRef: { kind: 'person' as const, id: speaker } } : {}), text: result.text, source: 'generated', turnId });
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
