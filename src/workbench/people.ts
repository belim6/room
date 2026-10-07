import { getAttachments } from './attachments';
import { Engine, emptyRoomState, assemble, validateState, type State, type Character, type TemplateField } from './engine';
import { Vault, type VaultRevision } from './vault';
import { clone, id } from './store';
import { DEFAULT_MODEL } from './generation';
import { DEFAULT_FRAME } from '../speakerTurn';
import { assemblyOf, labelOf, labelKey, validateLabel, NARRATOR } from './identity';
import { knownPlace, placeName, stamp, validatePlaceName, whoLabel, HUMAN, type Locations } from './locations';
import { lineDiff } from './changes';
// People in rooms: instantiation, renames, participation and explicit, previewed adoption. Nothing here calls a provider.
const FIELDS: TemplateField[] = ['system', 'frame', 'flow'];
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export const SWITCH_NOTES = ['Replies will be checked against this room\'s full cast plus your name, instead of the 8 legacy names.',
  'Requests will use v2 assembly: persona prompt, situation, room instructions, retained memory, identity line. A room without saved framing uses the default framing text.',
  'Earlier revisions, and any replay of them, keep legacy behavior.'];
export class People {
  constructor(public engine: Engine, public vault: Vault) {}
  get store() { return this.engine.store; }
  private revisionOf(ref: any, type: 'persona' | 'room-template'): VaultRevision {
    if (!ref || typeof ref.item !== 'string' || typeof ref.revision !== 'string') throw Error(`Choose a ${type} revision`);
    const rev = this.vault.revision(ref.revision), item = this.vault.item(ref.item);
    if (rev.item !== item.id || item.type !== type) throw Error(`That is not a ${type} revision`);
    return rev;
  }
  // Compiled text of the revision a person came from, or null for a blank person.
  originText(c: Character) { try { return c.origin ? this.vault.revision(c.origin.revision).content.compiled as string : null; } catch { return null; } }
  status(s: State) {
    return Object.fromEntries(Object.entries(s.characters).map(([key, c]) => {
      // "Update available" means the persona's head compiles to different text than the revision this person came from.
      const compiled = this.originText(c); let latest: string | null = null, title: string | null = null;
      if (c.origin) try { const item = this.vault.item(c.origin.item); latest = item.head === c.origin.revision ? null : this.vault.revision(item.head).content.compiled; title = item.title; } catch {}
      return [key, { label: labelOf(s, key), active: s.participants.includes(key), origin: c.origin ?? null, originTitle: title,
        diverged: compiled !== null && compiled !== c.prompt, updateAvailable: latest !== null && latest !== compiled }];
    }));
  }
  templateStatus(s: State) {
    return Object.fromEntries(FIELDS.filter(f => s.templateFields?.[f]).map(f => {
      // Per field: an update is available only when the template's head sets this field to a different value.
      const p = s.templateFields![f]!; let latest: unknown; try { const item = this.vault.item(p.item); if (item.head !== p.revision) latest = this.vault.revision(item.head).content[f]; } catch {}
      return [f, { ...p, diverged: !same(f === 'flow' ? s.flow ?? 'random' : s[f], p.value), updateAvailable: latest !== undefined && !same(latest, p.value) }];
    }));
  }
  private person(input: any): Character {
    const c: Character = { label: validateLabel(input.label), prompt: '', situation: typeof input.situation === 'string' ? input.situation : '', memory: '',
      provider: input.provider ?? 'opengateway', model: typeof input.model === 'string' && input.model.trim() ? input.model.trim() : DEFAULT_MODEL,
      temperature: input.temperature === undefined ? 0.7 : Number(input.temperature), ...(input.reasoning === 'off' ? { reasoning: 'off' as const } : {}) };
    if (input.persona) { const rev = this.revisionOf(input.persona, 'persona'); c.prompt = rev.content.compiled; c.origin = { item: input.persona.item, revision: input.persona.revision }; }
    else if (typeof input.prompt === 'string') c.prompt = input.prompt;
    return c;
  }
  // A legacy room switches to v2 only when the caller asked for it, in the same revision as the change that needs it.
  private switchIfNeeded(s: State, input: any, reason: string) {
    if (assemblyOf(s) === 'v2') return reason;
    if (input.switchAssembly !== true) throw Error('This room uses legacy assembly. This change switches it to v2; preview the switch and confirm it.');
    s.assemblyVersion = 'v2'; return reason + ' · switched to v2 assembly';
  }
  private planAdd(branch: string, input: any, preview = false) {
    const b = this.engine.read(branch), s = clone(b.revision.state), key = id(), c = this.person(input), legacy = assemblyOf(s) !== 'v2';
    s.characters[key] = c; s.participants.push(key);
    // Adding someone to a room with locations requires choosing their place; they hear nothing said before they arrived.
    if (s.locations) {
      if (!knownPlace(s, input.place) && !(preview && input.place === undefined)) throw Error(`Choose where ${c.label} starts`);
      s.locations.at[key] = input.place ?? s.locations.places[0].id;
    }
    return { b, s, key, c, legacy };
  }
  // The system message doesn't depend on history mode, so the preview skips perspective preflight.
  previewAdd(branch: string, input: any) {
    const { b, s, key, legacy } = this.planAdd(branch, { ...input, label: input.label || 'New person' }, true);
    if (legacy) s.assemblyVersion = 'v2';
    validateState(s, b.revision.state);
    return { person: key, assembled: assemble(this.store, { ...s, assembly: undefined }, key, false).system, switchRequired: legacy, ...(legacy ? { switchNotes: SWITCH_NOTES } : {}) };
  }
  add(branch: string, input: any) {
    const { s, c } = this.planAdd(branch, input), reason = this.switchIfNeeded(s, input, `Person added: ${c.label}`) + (s.locations ? ` in ${placeName(s, input.place)}` : '');
    return this.engine.commit(branch, input.expected, s, reason);
  }
  previewAssembled(branch: string, person: string, settings?: any) {
    const s = settings ? this.settingsState(branch,settings) : this.engine.read(branch).revision.state;
    validateState(s,s); if (!s.characters[person]) throw Error('Unknown person');
    const request=assemble(this.store,s,person);
    return { person, label: labelOf(s, person), assembled: request.system, messages: request.messages, images: s.messages.flatMap(m=>getAttachments(this.store,m.attachments).filter(a=>a.kind==='image').map(a=>({id:a.id,name:a.name}))), attachments: request.context.attachments, assembly: request.assembly, adapterVersion: request.adapterVersion, assemblyVersion: assemblyOf(s) };
  }
  rename(branch: string, person: string, input: any) {
    const b = this.engine.read(branch), s = clone(b.revision.state), c = s.characters[person];
    if (!c) throw Error('Unknown person');
    const before = labelOf(s, person); c.label = validateLabel(input.label);
    if (c.label === before) throw Error('That is already this person\'s label');
    const reason = this.switchIfNeeded(s, input, `Renamed ${before} to ${c.label}`);
    // Existing lines keep the label they were written under; situations naming the old label are flagged, not rewritten.
    return this.engine.commit(branch, input.expected, s, reason);
  }
  mentions(s: State, label: string) { return Object.entries(s.characters).filter(([, c]) => c.situation && c.situation.toLowerCase().includes(label.toLowerCase())).map(([k]) => k); }
  participation(branch: string, person: string, input: any) {
    const b = this.engine.read(branch), s = clone(b.revision.state);
    if (!s.characters[person]) throw Error('Unknown person');
    if (typeof input.active !== 'boolean') throw Error('Choose active or inactive');
    // Deactivating keeps the person in the cast, so their history, label and attribution survive.
    const rejoin = input.active && !s.participants.includes(person);
    s.participants = input.active ? [...new Set([...s.participants, person])] : s.participants.filter(p => p !== person);
    // Rejoining a room with locations confirms the old place or sets a new one; neither grants earlier scoped lines.
    if (rejoin && s.locations) { if (!knownPlace(s, input.place)) throw Error(`Choose where ${labelOf(s, person)} rejoins`); s.locations.at[person] = input.place; }
    return this.engine.commit(branch, input.expected, s, `${labelOf(s, person)} ${input.active ? 'rejoined' : 'left'} the room${rejoin && s.locations ? ` in ${placeName(s, input.place)}` : ''}`);
  }
  previewPersona(branch: string, person: string, input: any) {
    const s = this.engine.read(branch).revision.state, c = s.characters[person];
    if (!c) throw Error('Unknown person');
    const rev = this.revisionOf(input.persona, 'persona');
    if (c.origin && c.origin.item !== input.persona.item) throw Error('This person came from a different persona');
    const compiled = this.originText(c), diverged = c.origin ? compiled !== c.prompt : !!c.prompt.trim();
    return { person, diverged, diff: lineDiff(c.prompt, rev.content.compiled), fields: { prompt: { before: c.prompt, after: rev.content.compiled }, origin: { before: c.origin ?? null, after: { item: input.persona.item, revision: input.persona.revision } } },
      unchanged: ['label', 'situation', 'memory', 'provider', 'model', 'temperature', 'reasoning'] };
  }
  // Adoption touches only the prompt and its origin, on the current branch only. A locally edited prompt needs replace-or-cancel.
  adoptPersona(branch: string, person: string, input: any) {
    const preview = this.previewPersona(branch, person, input);
    if (preview.diverged && input.replace !== true) throw Error('This person\'s prompt was edited here. Replace it with the new compiled text, or cancel.');
    const s = clone(this.engine.read(branch).revision.state), c = s.characters[person];
    c.prompt = preview.fields.prompt.after; c.origin = preview.fields.origin.after;
    return this.engine.commit(branch, input.expected, s, `Adopted persona revision for ${labelOf(s, person)}`, undefined,
      { kind: 'persona', source: c.origin, person, fields: ['prompt', 'origin'], ...(preview.diverged ? { replacedDiverged: ['prompt'] } : {}) });
  }
  previewTemplate(branch: string, input: any) {
    const s = this.engine.read(branch).revision.state, rev = this.revisionOf(input.template, 'room-template'), t = rev.content;
    return { fields: Object.fromEntries(FIELDS.map(f => {
      const before = f === 'flow' ? s.flow ?? 'random' : s[f], after = t[f], p = s.templateFields?.[f];
      // Without provenance, or once edited here, the current value counts as local and replacing it needs confirmation.
      const text = (v: unknown) => typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v, null, 2);
      return [f, { before: before ?? null, after: after ?? null, available: after !== undefined, changed: after !== undefined && !same(before, after), local: !p || !same(before, p.value), provenance: p ?? null, diff: lineDiff(text(before), text(after)) }];
    })) as Record<TemplateField, { before: unknown; after: unknown; available: boolean; changed: boolean; local: boolean; provenance: unknown; diff: unknown }> };
  }
  // Template → room covers system, frame and flow, each opted in individually. Cast and opening are never re-applied.
  adoptTemplate(branch: string, input: any) {
    const fields: TemplateField[] = input.fields;
    if (!Array.isArray(fields) || !fields.length || fields.some(f => !FIELDS.includes(f)) || new Set(fields).size !== fields.length) throw Error('Choose which of system, frame and flow to adopt');
    const preview = this.previewTemplate(branch, input), s = clone(this.engine.read(branch).revision.state);
    for (const f of fields) {
      const p = preview.fields[f];
      if (!p.available) throw Error(`This template has no ${f}`);
      if (p.changed && p.local && input.replace !== true) throw Error(`The room's ${f} was changed here. Confirm replacing it, or leave ${f} out.`);
      if (f === 'flow' && p.after === 'alternate' && s.participants.length !== 2 && !s.locations) throw Error('Back-and-forth needs exactly two active participants');
      (s as any)[f] = clone(p.after);
      s.templateFields = { ...s.templateFields, [f]: { item: input.template.item, revision: input.template.revision, value: clone(p.after) } };
    }
    return this.engine.commit(branch, input.expected, s, `Adopted template ${fields.join(', ')}`, undefined,
      { kind: 'template', source: { item: input.template.item, revision: input.template.revision }, fields, replacedDiverged: fields.filter(f => preview.fields[f].changed && preview.fields[f].local) });
  }
  // Every new room is v2. A template is snapshotted: system, frame, flow, opening (inserted once, here) and cast.
  createRoom(input: any) {
    const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : 'New room', s = emptyRoomState();
    if (!input.template) return this.engine.create(name, s, null, null, undefined, undefined, 'Room created (empty)');
    const rev = this.revisionOf(input.template, 'room-template'), t = rev.content, ref = { item: input.template.item, revision: input.template.revision };
    s.system = t.system; s.frame = t.frame ? { ...t.frame } : { ...DEFAULT_FRAME }; s.flow = t.flow;
    // Template places get fresh IDs; unassigned cast members and the human start in the first place.
    const places: { id: string; name: string }[] | undefined = t.places?.map((name: string) => ({ id: id(), name })), where = (name?: string) => (places!.find(p => p.name === name) ?? places![0]).id;
    if (places) s.locations = { places, at: { [HUMAN]: where(t.humanPlace) } };
    for (const entry of t.cast) { const c = this.person({ label: entry.label, situation: entry.situation, persona: entry.persona }); const key = id(); s.characters[key] = c; s.participants.push(key); if (places) s.locations!.at[key] = where(entry.place); }
    // A human opening is heard where the human starts; a narrator opening is public in this release.
    if (t.opening) s.messages.push({ id: id(), speaker: t.opening.kind === 'human' ? s.human : NARRATOR, speakerRef: { kind: t.opening.kind }, text: t.opening.text, source: 'template', ...(places && t.opening.kind === 'human' ? { audience: stamp(s, s.locations!.at[HUMAN]) } : {}) });
    if (s.flow === 'alternate' && s.participants.length !== 2 && !places) s.flow = 'random';
    s.origin = { template: ref };
    s.templateFields = Object.fromEntries(FIELDS.filter(f => t[f] !== undefined).map(f => [f, { ...ref, value: clone(f === 'flow' ? s.flow : s[f]) }]));
    return this.engine.create(name, s, null, null, undefined, undefined, `Room created from template · ${this.vault.item(ref.item).title}`);
  }
  // Enabling locations takes a complete placement: every person, active or not, and you. Earlier history stays public.
  private planLocations(branch: string, input: any) {
    const b = this.engine.read(branch), s = clone(b.revision.state), legacy = assemblyOf(s) !== 'v2';
    if (s.locations) throw Error('This room already has locations');
    const names = input.places;
    if (!Array.isArray(names) || !names.length || names.length > 50) throw Error('Name at least one place');
    const places = names.map((n: unknown) => ({ id: id(), name: validatePlaceName(typeof n === 'string' ? n.trim() : n) }));
    if (new Set(places.map(p => labelKey(p.name))).size !== places.length) throw Error('Two places have the same name');
    const keys = [...Object.keys(s.characters), HUMAN], at = input.at;
    if (!at || typeof at !== 'object' || Object.keys(at).length !== keys.length || keys.some(k => !places.some(p => p.name === at[k]))) throw Error('Place everyone, including inactive people and you');
    const locations: Locations = { places, at: Object.fromEntries(keys.map(k => [k, places.find(p => p.name === at[k])!.id])) };
    s.locations = locations;
    return { b, s, legacy };
  }
  previewLocations(branch: string, input: any) {
    const { b, s, legacy } = this.planLocations(branch, input);
    if (legacy) s.assemblyVersion = 'v2';
    validateState(s, b.revision.state);
    return { places: s.locations!.places.map(p => p.name), placement: Object.entries(s.locations!.at).map(([k, p]) => ({ key: k, label: whoLabel(s, k), place: placeName(s, p), active: k === HUMAN || s.participants.includes(k) })),
      notes: ['Existing messages stay public. Only lines said after this are scoped to a place.', 'No movement line is written.', 'Locations cannot be turned off again in this release.'], switchRequired: legacy, ...(legacy ? { switchNotes: SWITCH_NOTES } : {}) };
  }
  enableLocations(branch: string, input: any) {
    const { s } = this.planLocations(branch, input), reason = this.switchIfNeeded(s, input, `Locations enabled: ${s.locations!.places.map(p => p.name).join(', ')}`);
    return this.engine.commit(branch, input.expected, s, reason);
  }
  // Renames show from now on; lines already stamped keep the name they were stamped with.
  renamePlace(branch: string, place: string, input: any) {
    const s = clone(this.engine.read(branch).revision.state), p = s.locations?.places.find(x => x.id === place);
    if (!p) throw Error('Unknown place');
    const before = p.name, name = validatePlaceName(typeof input.name === 'string' ? input.name.trim() : input.name);
    if (name === before) throw Error('That is already this place\'s name');
    if (s.locations!.places.some(x => x.id !== place && labelKey(x.name) === labelKey(name))) throw Error(`There is already a place named ${name}`);
    p.name = name;
    return this.engine.commit(branch, input.expected, s, `Renamed place ${before} to ${name}`);
  }
  // Settings save is a field-level merge: people are added, renamed and removed through their own actions.
  private settingsState(branch: string, body: any) {
    const b = this.engine.read(branch), s = clone(b.revision.state);
    for (const key of ['system', 'human', 'shadow', 'policy'] as const) if (body[key] !== undefined) (s as any)[key] = body[key];
    if (body.participants !== undefined) s.participants = body.participants;
    if (body.assembly !== undefined) s.assembly = clone(body.assembly);
    if (body.frame === null) delete s.frame; else if (body.frame !== undefined) s.frame = body.frame;
    if (body.flow !== undefined && (body.flow !== (s.flow ?? 'random') || s.flow !== undefined)) s.flow = body.flow;
    for (const [person, fields] of Object.entries(body.characters ?? {})) {
      const c = s.characters[person];
      if (!c || !fields || typeof fields !== 'object') throw Error('Unknown person in settings');
      for (const [field, value] of Object.entries(fields as object)) {
        if (['label', 'origin'].includes(field)) { if (!same(value, (c as any)[field])) throw Error(field === 'label' ? 'Use Rename to change a label' : 'Origin is provenance and cannot be edited'); continue; }
        if (!['prompt', 'memory', 'provider', 'model', 'temperature', 'reasoning', 'situation'].includes(field)) throw Error('Unknown character field');
        if (field === 'reasoning' && (value === 'default' || value === undefined)) delete c.reasoning; else if (field === 'situation' && value === '' && c.situation === undefined) continue; else (c as any)[field] = value;
      }
    }
    validateState(s,b.revision.state); return s;
  }
  settings(branch: string, body: any) {
    return this.engine.commit(branch, body.expected, this.settingsState(branch,body), 'Settings updated');
  }
}
