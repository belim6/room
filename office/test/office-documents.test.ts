import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config, Allowlist, type Config } from '../collect/privacy';
import { deniedDocument, visibleDocuments } from '../collect/deny';
import { artifactDocumentCounts, nodeDocuments } from '../collect/documents';
import { withholdDenied } from '../collect/expand';
import type { Artifact, OperationNode } from '../collect/types';

const roots: string[] = []; test.after(() => roots.forEach(r => fs.rmSync(r, { recursive: true, force: true })));
test('one canonical deny-list excludes every protected class from visibility and counts', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'office-docs-'))); roots.push(root);
  const cfg: Config = { ...config({ OFFICE_HOME: root, OFFICE_ROOM: root } as any), home: root, room: root, coordination: path.join(root,'coordination'), work: path.join(root,'work'), research:path.join(root,'research'), promptKnowledge:path.join(root,'prompt-knowledge'), roomData:path.join(root,'.room-data'), claudeProject:path.join(root,'claude'), repos:[root], extra:[], operations:path.join(root,'work/operations.json'), sessions:path.join(root,'roles/sessions.json') };
  const paths = ['restricted/key.json','labels/private.md','conversation-01.md','archive/private/secret.md','archive/personality/secret.md','.room-data/turns/id.json','roles/partner/deniz-model.md','work/ok/README.md'];
  for (const p of paths) { const f=path.join(root,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,'PRIVATE-CONTENT-MARKER'); }
  fs.symlinkSync(path.join(root,'restricted'),path.join(root,'shortcut'));
  fs.mkdirSync(path.join(root,'work/child'),{recursive:true});
  fs.writeFileSync(cfg.operations!,JSON.stringify([{id:'work',title:'Work',parent:null,goal:'g',status:'active',owner:'D',budget:{}},{id:'work/child',title:'Child',parent:'work',goal:'g',status:'active',owner:'D',budget:{}}]));
  const allow=new Allowlist(cfg), entries=paths.map(p=>({path:path.join(root,p)}));
  allow.blind=p=>p.includes('/arm-a/');
  fs.mkdirSync(path.join(root,'arm-A'),{recursive:true});fs.writeFileSync(path.join(root,'arm-A/notes.md'),'BLIND-MARKER');
  entries.push({path:path.join(root,'arm-A/notes.md')});
  for(const item of entries.filter(x=>!x.path.endsWith('README.md'))) assert.equal(deniedDocument(item.path,allow),true,item.path);
  assert.equal(deniedDocument(path.join(root,'shortcut','..','shortcut','key.json'),allow),true,'canonical symlink and parent traversal');
  assert.equal(deniedDocument(entries.find(x=>x.path.endsWith('README.md'))!.path,allow),false);
  assert.equal(visibleDocuments(entries,allow).length,1);
  assert.equal(cfg.operations, path.join(root,'work/operations.json'));
  assert.ok(!JSON.stringify(visibleDocuments(entries,allow)).includes('PRIVATE-CONTENT-MARKER'));
  const nodes=[{id:'work',title:'Work',parent:null,goal:'',status:'active',owner:'',budget:{}},{id:'work/child',title:'Child',parent:'work',goal:'',status:'active',owner:'',budget:{}}] as OperationNode[];
  const docs:Artifact[]=[
    {path:path.join(root,'work/ok/results.md'),operation:'work/child',group:'work',size:1,mtime:'2026-01-01'},
    {path:path.join(root,'work/ok/README.md'),operation:'work',group:'work',size:1,mtime:'2026-01-01'},
    {path:path.join(root,'work/ok/critic-old.md'),operation:'work',group:'work',size:1,mtime:'2026-01-01'},
    {path:path.join(root,'work/ok/critic-new.md'),operation:'work/child',group:'work',size:1,mtime:'2026-02-01'},
    {path:path.join(root,'work/ok/packet-for-deniz.md'),operation:'work',group:'work',size:1,mtime:'2026-01-01'},
    {path:path.join(root,'work/ok/run.sh'),operation:'work',group:'work',size:1,mtime:'2026-01-01'},
    {path:path.join(root,'work/ok/service.raw.log'),operation:'work',group:'work',size:1,mtime:'2026-01-01'},
    {path:path.join(root,'work/ok/unplaced.md'),group:'work',size:1,mtime:'2026-01-01'},
    ...entries.filter(x=>!x.path.endsWith('README.md')).map(x=>({path:x.path,group:'work',size:1,mtime:'2026-01-01'})),
  ];
  const totals=artifactDocumentCounts(nodes,docs,allow);
  assert.equal(totals.counts.get('work'),5);assert.equal(totals.counts.get('work/child'),2);assert.equal(totals.unfiled,1);
  const parent=nodeDocuments('work',nodes,docs,allow);
  assert.equal(parent.length,7);assert.equal(parent[0].title,'results');assert.deepEqual(parent.filter(x=>x.title.startsWith('critic')).map(x=>x.title),['critic new','critic old']);
  assert.ok(!JSON.stringify(parent).includes('PRIVATE-CONTENT-MARKER'));
  assert.equal(parent.find(x=>x.title==='results')?.operation,'work/child');assert.equal(parent.at(-1)?.path.endsWith('.raw.log'),true);
  assert.deepEqual(nodeDocuments('unfiled',nodes,docs,allow).map(x=>x.title),['unplaced']);
});

test('event expansion withholds events that target, name or command on a denied document', async () => {
  const os = await import('node:os'), pth = await import('node:path');
  const home = os.tmpdir(), c: any = { allow: new Allowlist(config({ OFFICE_HOME: home })) };
  const r = (title: string, text: string, p?: string) => ({ id: 'e', source: { file: 'f', lines: [1] }, sections: [{ title, text, path: p, allowed: true }] as any[] });
  const ev = (target?: string) => ({ target: target ? { kind: 'file', path: target } : undefined }) as any;
  for (const p of ['restricted/key.json', 'labels/a.json', 'archive/private/x.md', 'archive/personality/x.md', 'conversation-01.md', 'roles/partner/deniz-model.md', '.room-data/turns/1.json'])
    assert.equal(withholdDenied(c, ev(pth.join(home, 'dev/room', p)), r('file read', 'secret')).sections[0].title, 'withheld', p);
  assert.equal(withholdDenied(c, ev(), r('command', 'cat dev/room/restricted/key.json')).sections[0].title, 'withheld');
  assert.equal(withholdDenied(c, ev(), r('command', 'ls src')).sections[0].title, 'command');
});
