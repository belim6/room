import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export const id = () => randomUUID();
export const clone = <T>(value: T): T => structuredClone(value);
export class Store {
  constructor(public root: string) { fs.mkdirSync(root, { recursive: true, mode: 0o700 }); }
  file(kind: string, key: string) {
    if (!/^[a-z-]+$/.test(kind) || !/^[a-zA-Z0-9_-]+$/.test(key)) throw Error('Invalid record identifier');
    return path.join(this.root, kind, key + '.json');
  }
  put(kind: string, key: string, value: unknown) {
    const target = this.file(kind, key);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    const temp = target + '.' + id() + '.tmp';
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, target);
  }
  add(kind: string, value: any) { const key = value.id || id(); this.put(kind, key, { ...value, id: key }); return key; }
  get<T = any>(kind: string, key: string): T { return JSON.parse(fs.readFileSync(this.file(kind, key), 'utf8')); }
  list<T = any>(kind: string): T[] {
    const dir = path.join(this.root, kind);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => this.get<T>(kind, f.slice(0, -5)));
  }
  attempts() {
    const outcomes = new Map(this.list('outcomes').map(o => [o.id, o]));
    return this.list('attempts').map(a => ({ ...a, outcome: outcomes.get(a.id) ?? null }));
  }
}
