import fs from 'node:fs';
import path from 'node:path';
import { Store, clone, id } from './store';
import { lineDiff } from './changes';
import { validateLabel, labelKey } from './identity';
// Vault: mutable item metadata (head, archived, title) beside immutable revisions. Content is data; it never gains capabilities.
export type ItemType = 'component' | 'persona' | 'room-template';
export interface VaultItem { id: string; type: ItemType; title: string; head: string; createdAt: string; archived: boolean }
export interface VaultRevision { id: string; item: string; parent: string | null; at: string; author: string; note?: string; schema: 1; content: any }
export interface VaultKind { id: string; name: string; description: string; examples: string[]; archived: boolean; head: string; createdAt: string }
const now = () => new Date().toISOString();
const TYPES: ItemType[] = ['component', 'persona', 'room-template'];
// Seeded once into a fresh data directory as ordinary editable records.
export const STARTER_KINDS = [
  { name: 'archetype', description: 'A recognizable role or type the person draws on.', examples: ['the reluctant expert', 'the host who keeps everyone fed'] },
  { name: 'trait', description: 'A stable disposition.', examples: ['notices costs before benefits'] },
  { name: 'voice/form', description: 'How the person writes: register, length, typography, rhythm.', examples: ['lowercase, short sentences, suspicious quotation marks'] },
  { name: 'belief', description: 'Something the person holds to be true, and how firmly.', examples: ['institutions are mostly people protecting their weekends'] },
  { name: 'want', description: 'A portable want. Wants for one room or one evening belong in the situation instead.', examples: ['wants recognition but dislikes asking for it'] },
  { name: 'habit', description: 'A recurring behavior.', examples: ['answers a question with a smaller, more concrete question'] },
  { name: 'tension/contradiction', description: 'Elements that pull against each other, linked rather than listed.', examples: ['wants company, but treats invitations as obligations; then complains nobody comes around', 'makes jokes whenever someone gets close'] },
  { name: 'example lines', description: 'Plain text sample lines. They are not sent as separate chat messages.', examples: ['"sure.. and the receipts are where?"'] },
];
export const compileV1 = (texts: string[], extra: string) => [...texts, extra].map(t => t.trim()).filter(Boolean).join('\n\n');
const str = (v: unknown, max: number, what: string, empty = true) => { if (typeof v !== 'string' || v.length > max || (!empty && !v.trim())) throw Error(`Invalid ${what}`); return v; };
const only = (o: any, keys: string[], what: string) => { if (!o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).some(k => !keys.includes(k))) throw Error(`Invalid ${what}`); };
const isRef = (r: any) => !!r && typeof r === 'object' && typeof r.item === 'string' && typeof r.revision === 'string' && Object.keys(r).length === 2;
export class Vault {
  constructor(public store: Store) {}
  seedKinds() {
    if (this.store.readOnly || fs.existsSync(path.join(this.store.root, 'vault-kinds'))) return;
    for (const k of STARTER_KINDS) this.createKind({ ...k, note: 'Starter kind' });
  }
  kinds() { return this.store.list<VaultKind>('vault-kinds').sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)); }
  private kindContent(input: any) {
    const examples = input.examples ?? [];
    if (!Array.isArray(examples) || examples.length > 20 || examples.some((e: unknown) => typeof e !== 'string' || e.length > 2000)) throw Error('Invalid kind examples');
    return { name: str(input.name, 80, 'kind name', false).trim(), description: str(input.description ?? '', 2000, 'kind description'), examples };
  }
  createKind(input: any) {
    const content = this.kindContent(input), kind = id(), rev = id(), at = now();
    this.store.put('vault-kind-revisions', rev, { id: rev, kind, parent: null, at, ...(input.note ? { note: String(input.note).slice(0, 2000) } : {}), content });
    const value: VaultKind = { id: kind, ...content, archived: false, head: rev, createdAt: at }; this.store.put('vault-kinds', kind, value); return value;
  }
  // Renaming keeps the kind's ID, so components and analyses that refer to it don't break.
  reviseKind(key: string, input: any) {
    const kind = this.store.get<VaultKind>('vault-kinds', key);
    if (input.expected !== kind.head) throw Error('This kind changed. Reload before editing it.');
    const content = this.kindContent(input), rev = id();
    this.store.put('vault-kind-revisions', rev, { id: rev, kind: key, parent: kind.head, at: now(), content });
    const value = { ...kind, ...content, head: rev }; this.store.put('vault-kinds', key, value); return value;
  }
  archiveKind(key: string, input: any) {
    const kind = this.store.get<VaultKind>('vault-kinds', key);
    if (input.expected !== kind.head) throw Error('This kind changed. Reload before archiving it.');
    if (typeof input.archived !== 'boolean') throw Error('Choose archive or restore');
    const value = { ...kind, archived: input.archived }; this.store.put('vault-kinds', key, value); return value;
  }
  item(key: string) { const item = this.store.get<VaultItem>('vault-items', key); return item; }
  revision(key: string) { return this.store.get<VaultRevision>('vault-revisions', key); }
  list() { return this.store.list<VaultItem>('vault-items').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(item => ({ ...item, current: this.revision(item.head) })); }
  detail(key: string) {
    const item = this.item(key), current = this.revision(item.head), revisions: VaultRevision[] = [current];
    while (revisions[0].parent) revisions.unshift(this.revision(revisions[0].parent));
    const refs = item.type === 'persona' ? current.content.components : item.type === 'room-template' ? current.content.cast.map((c: any) => c.persona) : [];
    // Newer revisions of what this revision references; adopting one is an explicit new revision.
    const updates = refs.map((r: any) => { const ref = this.item(r.item); return ref.head !== r.revision ? { item: r.item, revision: r.revision, head: ref.head, title: ref.title } : null; }).filter(Boolean);
    return { item, revisions, current, updates };
  }
  // Validates content against its type and computes `compiled` server-side; a client-sent compiled must match.
  validate(type: ItemType, content: any) {
    if (type === 'component') {
      only(content, ['text', 'kind', 'tags'], 'component');
      const kinds = new Set(this.kinds().map(k => k.id)), tags = content.tags ?? [];
      if (content.kind !== undefined && !kinds.has(content.kind)) throw Error('Unknown component kind');
      if (!Array.isArray(tags) || tags.length > 20 || new Set(tags).size !== tags.length || tags.some((t: unknown) => typeof t !== 'string' || !kinds.has(t))) throw Error('Unknown component tag');
      return { text: str(content.text, 20000, 'component text'), ...(content.kind !== undefined ? { kind: content.kind } : {}), ...(tags.length ? { tags } : {}) };
    }
    if (type === 'persona') {
      only(content, ['components', 'extra', 'compiler', 'compiled'], 'persona');
      if (!Array.isArray(content.components) || content.components.length > 100 || content.components.some((c: any) => !isRef(c))) throw Error('Invalid persona components');
      if ((content.compiler ?? 'v1') !== 'v1') throw Error('Unknown persona compiler');
      const texts = content.components.map((c: any) => {
        let rev: VaultRevision, item: VaultItem;
        try { rev = this.revision(c.revision); item = this.item(c.item); } catch { throw Error('A persona component no longer exists'); }
        if (rev.item !== c.item) throw Error('A component revision belongs to another item');
        if (item.type !== 'component') throw Error(`${item.title} is a ${item.type}, not a component`);
        return rev.content.text as string;
      });
      const extra = str(content.extra ?? '', 20000, 'persona extra text'), compiled = compileV1(texts, extra);
      if (content.compiled !== undefined && content.compiled !== compiled) throw Error('The compiled text does not match its components; it is computed by the server');
      return { components: content.components.map((c: any) => ({ item: c.item, revision: c.revision })), extra, compiler: 'v1', compiled };
    }
    if (type === 'room-template') {
      only(content, ['system', 'frame', 'flow', 'opening', 'cast'], 'room template');
      const f = content.frame;
      if (f !== undefined && (!f || typeof f !== 'object' || Object.keys(f).sort().join() !== 'context,identity,opening,turn' || Object.values(f).some(v => typeof v !== 'string' || (v as string).length > 20000))) throw Error('Invalid template framing');
      if (!['random', 'alternate'].includes(content.flow)) throw Error('Choose random or alternate flow');
      if (content.opening !== undefined) { only(content.opening, ['kind', 'text'], 'opening'); if (!['human', 'narrator'].includes(content.opening.kind)) throw Error('An opening is spoken by the human or a narrator'); str(content.opening.text, 20000, 'opening text', false); }
      if (!Array.isArray(content.cast) || content.cast.length > 50) throw Error('Invalid template cast');
      const keys = new Set<string>();
      const cast = content.cast.map((c: any) => {
        only(c, ['persona', 'label', 'situation'], 'cast entry');
        if (!isRef(c.persona)) throw Error('Each cast entry needs a persona revision');
        let rev: VaultRevision, item: VaultItem;
        try { rev = this.revision(c.persona.revision); item = this.item(c.persona.item); } catch { throw Error('A cast persona no longer exists'); }
        if (rev.item !== c.persona.item || item.type !== 'persona') throw Error('A cast entry must reference a persona revision');
        const label = validateLabel(c.label); if (keys.has(labelKey(label))) throw Error(`Two cast entries are labeled ${label}`); keys.add(labelKey(label));
        return { persona: { item: c.persona.item, revision: c.persona.revision }, label, ...(c.situation ? { situation: str(c.situation, 20000, 'situation') } : {}) };
      });
      return { system: str(content.system ?? '', 100000, 'template instructions'), ...(f ? { frame: { ...f } } : {}), flow: content.flow, ...(content.opening ? { opening: { kind: content.opening.kind, text: content.opening.text } } : {}), cast };
    }
    throw Error('Unknown vault item type');
  }
  private meta(input: any) {
    return { author: typeof input.author === 'string' && input.author.trim() ? input.author.trim().slice(0, 80) : 'user', ...(typeof input.note === 'string' && input.note.trim() ? { note: input.note.trim().slice(0, 2000) } : {}) };
  }
  create(input: any) {
    if (!TYPES.includes(input.type)) throw Error('Choose component, persona or room-template');
    const content = this.validate(input.type, input.content), title = str(input.title, 120, 'title', false).trim(), item: VaultItem = { id: id(), type: input.type, title, head: '', createdAt: now(), archived: false };
    const rev: VaultRevision = { id: id(), item: item.id, parent: null, at: item.createdAt, ...this.meta(input), schema: 1, content };
    item.head = rev.id; this.store.put('vault-revisions', rev.id, rev); this.store.put('vault-items', item.id, item);
    return this.detail(item.id);
  }
  revise(key: string, input: any) {
    const item = this.item(key);
    if (input.expected !== item.head) throw Error('This vault item changed. Reload before saving your edit.');
    const content = this.validate(item.type, input.content);
    const rev: VaultRevision = { id: id(), item: key, parent: item.head, at: now(), ...this.meta(input), schema: 1, content };
    this.store.put('vault-revisions', rev.id, rev);
    this.store.put('vault-items', key, { ...item, head: rev.id, ...(input.title !== undefined ? { title: str(input.title, 120, 'title', false).trim() } : {}) });
    return this.detail(key);
  }
  archive(key: string, input: any) {
    const item = this.item(key);
    if (input.expected !== item.head) throw Error('This vault item changed. Reload before archiving it.');
    if (typeof input.archived !== 'boolean') throw Error('Choose archive or restore');
    this.store.put('vault-items', key, { ...item, archived: input.archived }); return this.detail(key);
  }
  // A preview: validated content with its compiled text, nothing written.
  compile(input: any) { if (!TYPES.includes(input.type)) throw Error('Unknown vault item type'); return this.validate(input.type, clone(input.content)); }
  diff(key: string, from: string, to: string) {
    const a = this.revision(from), b = this.revision(to);
    if (a.item !== key || b.item !== key) throw Error('Both revisions must belong to this item');
    const text = (r: VaultRevision) => r.content.compiled ?? r.content.text ?? r.content.system ?? '';
    return { text: lineDiff(text(a), text(b)), structure: lineDiff(JSON.stringify(a.content, null, 2), JSON.stringify(b.content, null, 2)) };
  }
}
