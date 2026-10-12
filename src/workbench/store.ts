import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export const id = () => randomUUID();
export const clone = <T>(value: T): T => structuredClone(value);
export type Write = (kind: string, key: string, value: any) => void;
export class Store {
  private records = new Map<string,{stamp:string;value:any}>();
  private directories = new Map<string,{stamp:string;keys:string[]}>();
  private stamp(stat: fs.Stats) { return `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}:${stat.ino}`; }
  private keys(kind:string) {
    this.file(kind,'validate');
    const dir=path.join(this.root,kind);
    let stamp:string;try{stamp=this.stamp(fs.statSync(dir));}catch(e:any){if(e.code==='ENOENT')return [];throw e;}
    let cached=this.directories.get(kind);
    if(!cached||cached.stamp!==stamp){cached={stamp,keys:fs.readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>f.slice(0,-5))};this.directories.set(kind,cached);}
    return cached.keys;
  }
  private read(kind:string,key:string) {
    const file=this.file(kind,key),stamp=this.stamp(fs.statSync(file));
    let cached=this.records.get(file);
    if(!cached||cached.stamp!==stamp){cached={stamp,value:JSON.parse(fs.readFileSync(file,'utf8'))};this.records.set(file,cached);}
    return cached.value;
  }
  private listeners = new Set<Write>();
  // Called after each durable write; a listener failure never fails the write.
  subscribe(fn: Write) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  get subscribers() { return this.listeners.size; }
  // Read-only instances (ROOM_READONLY=1, restore verification) refuse every write instead of creating files.
  constructor(public root: string, public readOnly = false) { if (!readOnly) fs.mkdirSync(root, { recursive: true, mode: 0o700 }); }
  file(kind: string, key: string) {
    if (!/^[a-z-]+$/.test(kind) || !/^[a-zA-Z0-9_-]+$/.test(key)) throw Error('Invalid record identifier');
    return path.join(this.root, kind, key + '.json');
  }
  put(kind: string, key: string, value: unknown) {
    const target = this.file(kind, key);
    if (this.readOnly) throw Error('This instance is read-only; nothing was saved.');
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    const temp = target + '.' + id() + '.tmp';
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, target);
    for (const fn of this.listeners) try { fn(kind, key, value); } catch {}
  }
  add(kind: string, value: any) { const key = value.id || id(); this.put(kind, key, { ...value, id: key }); return key; }
  get<T = any>(kind: string, key: string): T { return clone(this.read(kind,key)); }
  list<T = any>(kind: string): T[] { return this.select<T>(kind,()=>true); }
  // Predicates only inspect cached records. Callers receive independent copies of matches.
  select<T = any>(kind:string, predicate:(record:T)=>boolean):T[] {
    const out:T[]=[];for(const key of this.keys(kind)){const value=this.read(kind,key);if(predicate(value))out.push(clone(value));}return out;
  }
  attempts(predicate:(record:any)=>boolean = ()=>true) {
    return this.select('attempts',predicate).map(a=>{
      let outcome=null;try{outcome=this.get('outcomes',a.id);}catch(e:any){if(e.code!=='ENOENT')throw e;}
      return {...a,outcome};
    });
  }

}
