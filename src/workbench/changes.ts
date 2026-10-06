import type { State, Message } from './engine';
import { labelOf, assemblyOf } from './identity';
export type LineDiff = { op: 'same' | 'add' | 'del'; text: string }[];
export interface SettingChange { field: string; character?: string; label?: string; before: unknown; after: unknown; diff?: LineDiff }
export function lineDiff(a: string, b: string): LineDiff {
  if (a === b) return a.split('\n').map(text => ({op:'same',text}));
  const left = a ? a.split('\n') : [], right = b ? b.split('\n') : [];
  if (left.length > 2000 || right.length > 2000) return [...left.map(text=>({op:'del' as const,text})),...right.map(text=>({op:'add' as const,text}))];
  const width = right.length + 1, table = new Uint16Array((left.length + 1) * width);
  for (let i=left.length-1;i>=0;i--) for(let j=right.length-1;j>=0;j--)
    table[i*width+j] = left[i]===right[j] ? 1+table[(i+1)*width+j+1] : Math.max(table[(i+1)*width+j],table[i*width+j+1]);
  const result: LineDiff = []; let i=0,j=0;
  while(i<left.length || j<right.length) {
    if(i<left.length && j<right.length && left[i]===right[j]) { result.push({op:'same',text:left[i++]});j++; }
    else if(i<left.length && (j===right.length || table[(i+1)*width+j]>=table[i*width+j+1])) result.push({op:'del',text:left[i++]});
    else result.push({op:'add',text:right[j++]});
  }
  return result;
}
export function stateChanges(from: State, to: State) {
  const settings: SettingChange[] = [];
  function field(field: string, before: unknown, after: unknown, character?: string) {
    if(JSON.stringify(before)===JSON.stringify(after))return;
    settings.push({field,...(character?{character,label:labelOf(to.characters[character]?to:from,character)}:{}),before,after,...(typeof before==='string' && typeof after==='string' && (before.includes('\n')||after.includes('\n'))?{diff:lineDiff(before,after)}:{})});
  }
  for(const key of ['system','human','participants','shadow','policy'] as const) field(key,from[key],to[key]);
  field('frame',from.frame??null,to.frame??null);
  field('flow',from.flow??'random',to.flow??'random');field('assemblyVersion',assemblyOf(from),assemblyOf(to));
  field('origin',from.origin??null,to.origin??null);field('templateFields',from.templateFields??null,to.templateFields??null);
  // People present on both sides are compared field by field; additions and removals are listed, never assumed away.
  const added=Object.keys(to.characters).filter(p=>!from.characters[p]),dropped=Object.keys(from.characters).filter(p=>!to.characters[p]);
  for(const name of Object.keys(from.characters).filter(p=>to.characters[p])) {const a=from.characters[name],b=to.characters[name];
    field('label',labelOf(from,name),labelOf(to,name),name);
    for(const key of ['prompt','memory','provider','model','temperature'] as const) field(key,a[key],b[key],name);field('reasoning',a.reasoning||'default',b.reasoning||'default',name);
    field('situation',a.situation??'',b.situation??'',name);field('origin',a.origin??null,b.origin??null,name);}
  const people={added,removed:dropped,activated:to.participants.filter(p=>!from.participants.includes(p)),deactivated:from.participants.filter(p=>!to.participants.includes(p)),
    labels:Object.fromEntries([...Object.keys(from.characters).map(p=>[p,labelOf(from,p)]),...Object.keys(to.characters).map(p=>[p,labelOf(to,p)])])};
  const old = new Map(from.messages.map(m=>[m.id,m])), now = new Map(to.messages.map(m=>[m.id,m]));
  const original = (m: Message) => old.has(m.id)?m.id:m.editedFrom?.find(key=>old.has(key));
  const represented = new Set(to.messages.map(original).filter(Boolean));
  const edited = to.messages.filter(m=>{const key=original(m),before=key?old.get(key):null;return before && (before.id!==m.id || before.text!==m.text || before.speaker!==m.speaker || JSON.stringify(before.speakerRef??null)!==JSON.stringify(m.speakerRef??null) || JSON.stringify(before.attachments||[])!==JSON.stringify(m.attachments||[]));}).map(m=>m.id);
  // Identity-only changes: same text, different attribution.
  const identity = to.messages.filter(m=>{const key=original(m),before=key?old.get(key):null;return before && before.text===m.text && JSON.stringify(before.speakerRef??null)!==JSON.stringify(m.speakerRef??null);}).map(m=>m.id);
  const removed = from.messages.filter(m=>!represented.has(m.id)).map(m=>m.id);
  const last = to.messages.reduce((n,m,i)=>original(m)?i:n,-1);
  const appended: Record<string,number> = {}, inserted: string[]=[];
  to.messages.forEach((m,i)=>{if(original(m))return;if(i>last)appended[m.source]=(appended[m.source]||0)+1;else inserted.push(m.id);});
  const retainedBefore = from.messages.filter(m=>represented.has(m.id)).map(m=>m.id);
  const retainedAfter = to.messages.map(original).filter(Boolean);
  return {settings,people,identity,conversation:{appended,edited,removed,inserted,reordered:JSON.stringify(retainedBefore)!==JSON.stringify(retainedAfter)}};
}
