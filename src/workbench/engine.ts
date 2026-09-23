import { Store, clone, id } from './store';
import { generate, type Provider } from './generation';
import { PERSONAS, type PersonaName } from '../personas/personas';
import { GLOBAL_SYSTEM } from '../modelRouter';
import { buildSpeakerInput } from '../speakerTurn';
import { shadowJev } from './jev';

export interface Character { prompt: string; memory: string; provider: Provider; model: string; temperature: number }
export interface Message { id: string; speaker: string; text: string; source: 'human' | 'generated' | 'imported' | 'edited'; turnId?: string; checkpoint?: string }
export interface State { system: string; participants: PersonaName[]; characters: Record<PersonaName, Character>;
  messages: Message[]; shadow: boolean; policy: 'protected' | 'observe'; human: string }
export interface Revision { id: string; branch: string; parent: string | null; at: string; reason: string; state: State }
export interface Branch { id: string; name: string; head: string; parent: string | null; fork: string | null; createdAt: string }
export interface TrashEntry { id: string; branch: string; name: string; branches: string[]; deletedAt: string; restoredAt?: string }
const names = Object.keys(PERSONAS) as PersonaName[];
export function initialState(): State {
  return { system: GLOBAL_SYSTEM, participants: [...names], messages: [], shadow: false, policy: 'protected', human: 'Dennis',
    characters: Object.fromEntries(names.map(name => [name, { prompt: PERSONAS[name].systemPrompt,
      memory: '', provider: 'demo', model: 'local-demo', temperature: 0.7 }])) as State['characters'] };
}
export function validateState(s: State) {
  if (!s || typeof s.system !== 'string' || s.system.length > 100000 || typeof s.human !== 'string' || !s.human.trim() || s.human.length > 80) throw Error('Invalid shared instructions or human name');
  if (!Array.isArray(s.participants) || !s.participants.length || new Set(s.participants).size !== s.participants.length || s.participants.some(p => !names.includes(p))) throw Error('Choose at least one valid participant');
  if (typeof s.shadow !== 'boolean' || !['protected','observe'].includes(s.policy)) throw Error('Invalid observation settings');
  for (const name of names) {
    const c = s.characters?.[name];
    if (!c || typeof c.prompt !== 'string' || typeof c.memory !== 'string' || !['demo','together','opengateway'].includes(c.provider) || typeof c.model !== 'string' || !c.model.trim() || c.model.length > 200 || !Number.isFinite(c.temperature) || c.temperature < 0 || c.temperature > 2) throw Error(`Invalid character settings: ${name}`);
  }
  if (!Array.isArray(s.messages) || s.messages.length > 10000 || s.messages.some(m => typeof m.id !== 'string' || typeof m.text !== 'string' || m.text.length > 100000 || typeof m.speaker !== 'string' || !m.speaker.trim() || m.speaker.length > 80)) throw Error('Invalid conversation');
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
  create(name = 'Untitled room', state = initialState(), parent: string | null = null, fork: string | null = null) {
    validateState(state);
    if (parent) this.available(parent);
    const branch: Branch = { id: id(), name: name.slice(0, 120), head: '', parent, fork, createdAt: new Date().toISOString() };
    const revision: Revision = { id: id(), branch: branch.id, parent: fork, at: new Date().toISOString(), reason: parent ? 'Branch created' : 'Room created', state: clone(state) };
    branch.head = revision.id; this.store.put('revisions', revision.id, revision); this.store.put('branches', branch.id, branch);
    return this.read(branch.id);
  }
  commit(branchId: string, expected: string, state: State, reason: string) {
    validateState(state);
    const b = this.available(branchId);
    if (b.head !== expected) throw Error('This branch changed. Reload before saving your edit.');
    const revision: Revision = { id: id(), branch: branchId, parent: b.head, at: new Date().toISOString(), reason, state: clone(state) };
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
  message(branchId: string, expected: string, text: string) {
    if (!text.trim() || text.length > 20000) throw Error('Write a message under 20,000 characters');
    const b = this.read(branchId); const s = clone(b.revision.state);
    const next = id();
    s.messages.push({ id: next, speaker: s.human, text: text.trim(), source: 'human' });
    const result = this.commit(branchId, expected, s, 'Human message');
    return result;
  }
  retcon(branchId: string, expected: string, messageId: string, text: string, mode: string, memory: string) {
    if (!['keep','regenerate'].includes(mode) || !['restore','keep'].includes(memory)) throw Error('Choose retcon and memory modes');
    const b = this.read(branchId); if (b.head !== expected) throw Error('Branch changed; reload first');
    const index = b.revision.state.messages.findIndex(m => m.id === messageId);
    if (index < 0) throw Error('Message no longer exists');
    const historical = this.checkpoint(branchId,messageId).revision;
    // Regeneration uses the entire historical state, not future settings.
    let s = clone(mode === 'regenerate' ? historical.state : b.revision.state);
    for (const n of names) s.characters[n].memory = (memory === 'restore' ? historical : b.revision).state.characters[n].memory;
    if (mode === 'regenerate') s.messages = s.messages.slice(0, index + 1);
    if (text.trim()) s.messages[index] = { ...s.messages[index], id: id(), text, source: 'edited' };
    else s.messages.splice(index, 1);
    const fork = this.create(`${b.name} · retcon`, s, b.id, b.head);
    this.store.add('edits', { branch: fork.id, sourceRevision: b.head, messageId, text, mode, memory, at: new Date().toISOString() });
    return fork;
  }
  cancel(branch: string) { this.active.get(branch)?.controller.abort(); }
  async turn(branchId: string, expected: string, forced?: PersonaName, run?: { id: string; index: number; count: number }) {
    if (this.active.has(branchId)) throw Error('A turn is already running in this branch');
    const b = this.read(branchId);
    if (b.head !== expected) throw Error('Branch changed; reload before generating');
    const s = clone(b.revision.state);
    if (forced && !s.participants.includes(forced)) throw Error('Selected character is not participating');
    const last = [...s.messages].reverse().find(m => names.includes(m.speaker as PersonaName))?.speaker;
    const eligible = s.participants.filter(p => p !== last);
    const pool = eligible.length ? eligible : s.participants;
    const speaker = forced || pool[Math.floor(Math.random() * pool.length)];
    const turnId = id(); const controller = new AbortController();
    this.active.set(branchId, { controller, turnId });
    this.store.put('selections', turnId, { id: turnId, branch: branchId, revision: b.head,
      at: new Date().toISOString(), // One operator pick repeated across a multi-turn run is a single decision: only its first turn is 'forced'.
      method: forced ? (run && run.index > 1 ? 'locked' : 'forced') : 'random', run: run ?? null,
      eligible: forced ? s.participants : pool, chosen: speaker });
    // Shadow captures this revision but never delays or influences generation.
    if (s.shadow) void shadowJev(this.store, s, branchId, b.head, turnId, this.transport).catch(error => console.error('Jev persistence error:', error.message));
    try {
      const c = s.characters[speaker];
      const system = `${c.prompt}\n\n${s.system}\n\n${c.memory ? `Your retained memory:\n${c.memory}\n\n` : ''}Your identity for this request is ${speaker}. Stay in your own perspective even if someone else is addressed. Keep your entire reply within 2000 characters.`;
      const transcript = s.messages.map(m => `${m.speaker}: ${m.text}`).join('\n');
      const user = buildSpeakerInput(speaker, transcript, s.participants).replace('Current participants: Dennis,', `Current participants: ${s.human},`);
      const result = await generate({ provider: c.provider, model: c.model, temperature: c.temperature, persona: speaker,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }], branch: branchId, revision: b.head, turnId,
        policy: s.policy, signal: controller.signal }, this.store, this.transport);
      if (controller.signal.aborted || this.read(branchId).head !== b.head) {
        this.store.put('turns', turnId, { id: turnId, branch: branchId, status: controller.signal.aborted ? 'canceled' : 'detached', attempts: result.attempts });
        return this.read(branchId);
      }
      s.messages.push({ id: id(), speaker, text: result.text, source: 'generated', turnId });
      // Memory updates are manual in this release. Proposed notes remain in the attempt.
      const next = this.commit(branchId, b.head, s, `${speaker} replied`);
      this.store.put('turns', turnId, { id: turnId, branch: branchId, status: 'attached', revision: next.head, attempts: result.attempts });
      return next;
    } catch (e: any) {
      this.store.put('turns', turnId, { id: turnId, branch: branchId, status: controller.signal.aborted ? 'canceled' : 'failed', error: e.message });
      throw e;
    } finally { this.active.delete(branchId); }
  }
}
