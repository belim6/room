import { Engine } from './engine';
import { id } from './store';
export interface Comparison {
  id: string; name: string; left: string; right: string;
  parent: string | null; version: string; createdAt: string; updatedAt: string;
  isolation?: 'owned-v1'; draft?: boolean;
}
export class Comparisons {
  constructor(private engine: Engine) {}
  private record(result: Comparison) {
    const left = this.engine.read(result.left), right = this.engine.read(result.right);
    this.engine.store.put('comparison-revisions',result.version,{...result,leftRevision:left.head,rightRevision:right.head});
    this.engine.store.put('comparisons',result.id,result);
    return result;
  }
  private copy(branch: string, owner: string) {
    const source = this.engine.read(branch);
    return this.engine.create(source.name,source.revision.state,null,source.head,owner);
  }
  get(key: string) {
    const comparison = this.engine.store.get<Comparison>('comparisons',key);
    this.engine.read(comparison.left); this.engine.read(comparison.right);
    if (comparison.isolation === 'owned-v1') return comparison;
    // Legacy links cannot distinguish in-comparison turns from external turns.
    // Preserve the current committed contents and the old pairing record.
    const left = this.copy(comparison.left,key), right = this.copy(comparison.right,key);
    return this.record({...comparison,left:left.id,right:right.id,isolation:'owned-v1',version:id(),updatedAt:new Date().toISOString()});
  }
  list() {
    const deleted = this.engine.deletedBranches();
    return this.engine.store.list<Comparison>('comparisons')
      .filter(c => !c.draft && !deleted.has(c.left) && !deleted.has(c.right)).map(c => this.get(c.id));
  }
  save(input: { id?: string; expected?: string; name: string; left: string; right: string }, parent: string | null = null, draft = false) {
    if (typeof input.name !== 'string' || !input.name.trim()) throw Error('Give the comparison a name');
    if (!input.left || !input.right || input.left === input.right) throw Error('Choose two different conversations or branches');
    const old = input.id ? this.get(input.id) : null;
    if (old && old.version !== input.expected) throw Error('This comparison changed in another session. Reopen it before saving.');
    const left = this.engine.read(input.left), right = this.engine.read(input.right), owner = old?.id || id();
    // A pane belongs to one comparison. Reusing or importing any other pane copies it.
    const a = left.comparison === owner ? left : this.copy(left.id,owner);
    const b = right.comparison === owner ? right : this.copy(right.id,owner);
    const now = new Date().toISOString();
    return this.record({ id:owner,name:input.name.trim().slice(0,120),left:a.id,right:b.id,
      parent:old?.parent ?? parent,version:id(),createdAt:old?.createdAt || now,updatedAt:now,isolation:'owned-v1',draft });
  }
  fork(key: string, name: string, expected: string) {
    const source = this.get(key);
    if (source.version !== expected) throw Error('This comparison changed. Reopen it before branching.');
    return this.save({name,left:source.left,right:source.right},source.id);
  }
}
