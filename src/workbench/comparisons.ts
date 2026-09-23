import { Engine } from './engine';
import { id } from './store';
export interface Comparison {
  id: string; name: string; left: string; right: string;
  parent: string | null; version: string; createdAt: string; updatedAt: string;
}
export class Comparisons {
  constructor(private engine: Engine) {}
  get(key: string) {
    const comparison = this.engine.store.get<Comparison>('comparisons',key);
    this.engine.read(comparison.left); this.engine.read(comparison.right);
    return comparison;
  }
  save(input: { id?: string; expected?: string; name: string; left: string; right: string }, parent: string | null = null) {
    if (typeof input.name !== 'string' || !input.name.trim()) throw Error('Give the comparison a name');
    if (!input.left || !input.right || input.left === input.right) throw Error('Choose two different conversations or branches');
    const left = this.engine.read(input.left), right = this.engine.read(input.right);
    const old = input.id ? this.get(input.id) : null;
    if (old && old.version !== input.expected) throw Error('This comparison changed in another session. Reopen it before saving.');
    const now = new Date().toISOString();
    const result: Comparison = { id:old?.id || id(), name:input.name.trim().slice(0,120), left:left.id, right:right.id,
      parent:old?.parent ?? parent, version:id(), createdAt:old?.createdAt || now, updatedAt:now };
    // Save pairing history independently of the two branches' generation records.
    this.engine.store.put('comparison-revisions',result.version,{...result,leftRevision:left.head,rightRevision:right.head});
    this.engine.store.put('comparisons',result.id,result);
    return result;
  }
  fork(key: string, name: string, expected: string) {
    const source = this.get(key);
    if (source.version !== expected) throw Error('This comparison changed. Reopen it before branching.');
    if (typeof name !== 'string' || !name.trim()) throw Error('Give the comparison branch a name');
    // Capture both heads synchronously; later completions cannot alter this snapshot.
    const left = this.engine.read(source.left), right = this.engine.read(source.right);
    const a = this.engine.fork(left.id,left.head,`${name} · left`);
    const b = this.engine.fork(right.id,right.head,`${name} · right`);
    return this.save({name,left:a.id,right:b.id},source.id);
  }
}
