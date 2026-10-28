import fs from 'node:fs';
import path from 'node:path';
import type { OfficeEvent, TokenUsage, TokenRollup } from './types';
import type { Allowlist } from './privacy';

const usageOf = (u: any, engine: string, model: unknown): TokenUsage => {
  const its = Array.isArray(u?.iterations) ? u.iterations : [];
  const src = its.length && its.some((x: any) => x?.output_tokens || x?.cache_read_input_tokens || x?.input_tokens) ? its : [u || {}];
  const sum = (k: string) => src.reduce((n: number, x: any) => n + (Number.isFinite(x?.[k]) ? x[k] : 0), 0);
  const v: TokenUsage = { input: sum('input_tokens'), output: sum('output_tokens'), cacheRead: sum(engine === 'codex' ? 'cached_input_tokens' : 'cache_read_input_tokens'), cacheWrite: sum('cache_creation_input_tokens'), model: typeof model === 'string' ? model : null, engine };
  v.weightedAssumption = v.input + v.output * 5 + v.cacheRead * .1 + v.cacheWrite * 1.25;
  return v;
};
const add = (a: TokenUsage, b: TokenUsage): TokenUsage => ({ input:a.input+b.input, output:a.output+b.output, cacheRead:a.cacheRead+b.cacheRead, cacheWrite:a.cacheWrite+b.cacheWrite, weightedAssumption:(a.weightedAssumption||0)+(b.weightedAssumption||0), model:a.model===b.model?a.model:null, engine:a.engine });
const zero = (engine = 'unknown'): TokenUsage => ({ input:0, output:0, cacheRead:0, cacheWrite:0, model:null, engine, weightedAssumption:0 });
const safeRead = (allow: Allowlist, p: string, ok: (p:string)=>boolean) => {
  const c=allow.canonical(p), o=allow.openVerified(c, ok); if (o==='missing'||o==='refused'||o.size>64_000_000) { if (o!=='missing'&&o!=='refused') fs.closeSync(o.fd); return null; }
  try { const b=Buffer.alloc(o.size); fs.readSync(o.fd,b,0,b.length,0); return b.toString('utf8'); } finally { fs.closeSync(o.fd); }
};
function files(root: string, pred: (p:string)=>boolean, out:string[]=[]):string[] { try { for(const n of fs.readdirSync(root).sort()){const p=path.join(root,n); let s; try{s=fs.lstatSync(p)}catch{continue} if(s.isDirectory()&&!s.isSymbolicLink()) files(p,pred,out); else if(s.isFile()&&pred(p)) out.push(p); } } catch {} return out; }
export interface UsageResult { unattributed: TokenUsage; records: number; attributedRecords: number; unattributedRecords: number; available: boolean }
/** Read local usage ledgers; attach only a unique exact transcript-line match. */
export function attachTokenUsage(events: OfficeEvent[], allow: Allowlist): UsageResult {
  const lines = new Map<string, number[]>(); events.forEach((e,i)=>{ if(e.source && e.detailRef?.file) for(const n of e.detailRef.lines||[]) { const k=`${allow.canonical(e.source)}:${n}`; lines.set(k,[...(lines.get(k)||[]),i]); } });
  let unattributed=zero(), records=0, attributedRecords=0, unattributedRecords=0;
  const claudeRoot=path.join(allow.cfg.home,'.claude/projects');
  const transcripts=files(claudeRoot,p=>/\.jsonl$/i.test(p)&&allow.isTokenTranscript(p));
  const codexRoot=path.join(allow.cfg.home,'.codex/sessions'), codexFiles=files(codexRoot,p=>/^rollout-.*\.jsonl$/.test(path.basename(p)));
  const available=transcripts.length>0||codexFiles.length>0;
  if(!available)return {unattributed,records,attributedRecords,unattributedRecords,available};
  // Live refreshes re-read the ledgers. Start from a clean attachment pass so
  // an event matched on a prior update is never added twice.
  for (const e of events) e.tokenUsage = null;
  const candidates=new Map<string,{file:string;line:number;usage:TokenUsage}>();
  for(const f of transcripts){ const text=safeRead(allow,f,p=>allow.isTokenTranscript(p)); if(text===null) continue; const best=new Map<string,{line:number;usage:TokenUsage}>();
    let logical=0; text.split(/\r?\n/).forEach((l)=>{if(!l.length)return;const i=logical++;let r:any;try{r=JSON.parse(l)}catch{return} if(r.type!=='assistant'||!r.message?.usage)return; const u=usageOf(r.message.usage,'claude',r.message.model); const id=r.message.id||r.uuid; if(!id)return; const prev=best.get(id); if(!prev||u.output>=prev.usage.output)best.set(id,{line:i,usage:u}); });
    for(const [id,v] of best){ const old=candidates.get(id), ix=lines.get(`${allow.canonical(f)}:${v.line}`)||[], oldIx=old?(lines.get(`${allow.canonical(old.file)}:${old.line}`)||[]):[]; if(!old || (ix.length===1&&oldIx.length!==1) || (ix.length===1&&oldIx.length===1&&v.usage.output>=old.usage.output)) candidates.set(id,{file:f,...v}); }
  }
  for(const v of candidates.values()){records++;const ix=lines.get(`${allow.canonical(v.file)}:${v.line}`)||[];if(ix.length===1){events[ix[0]].tokenUsage=v.usage;attributedRecords++;}else {unattributed=add(unattributed,v.usage);unattributedRecords++;}}
  // Codex rollout snapshots are cumulative. Retain only the final snapshot in each rollout file.
  for(const f of codexFiles) { let last:any=null; const txt=safeRead(allow,f,p=>p===allow.canonical(path.join(allow.cfg.home,'.codex/sessions'))||p.startsWith(allow.canonical(path.join(allow.cfg.home,'.codex/sessions'))+path.sep)); if(txt===null)continue;
    for(const l of txt.split(/\r?\n/)) if(l.includes('total_token_usage')) try {const r=JSON.parse(l); if(r.payload?.info?.total_token_usage)last=r.payload.info.total_token_usage;}catch{}
    if(last){records++;unattributedRecords++;unattributed=add(unattributed,usageOf(last,'codex',last.model));}
  }
  return {unattributed,records,attributedRecords,unattributedRecords,available};
}
export function tokenRollup(events: OfficeEvent[]): TokenRollup {
  const known=events.filter(e=>e.tokenUsage); const t=known.reduce((a,e)=>add(a,e.tokenUsage!),zero());
  return {input:t.input,output:t.output,cacheRead:t.cacheRead,cacheWrite:t.cacheWrite,weightedAssumption:t.weightedAssumption||0,weightedLabel:'Assumption: cacheRead × 0.1 + cacheWrite × 1.25 + input + output × 5',knownEvents:known.length,totalEvents:events.length};
}
