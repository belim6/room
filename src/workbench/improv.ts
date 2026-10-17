import { Store, id } from './store';
import { ENDPOINTS } from './generation';
import type { State } from './engine';
export interface Addition { id:string; text:string; turnId:string; at:string; afterTurns:number }
export interface ImprovConfig { enabled:boolean; jevPrompt:string; writerPrompt:string; provider:'opengateway'|'together'; model:string; temperature:number; threshold:number; cooldown:number; maxPerTen:number; budgetMs:number }
export const IMPROV_DEFAULTS:ImprovConfig={enabled:false,provider:'opengateway',model:'deepseek/deepseek-flash',temperature:.8,threshold:.8,cooldown:3,maxPerTen:3,budgetMs:8000,
  jevPrompt:"Should this character receive a new persistent system-prompt addition before speaking? Say yes only for a specific, timely creative opportunity that ordinary in-character continuation is likely to miss, in service of the writer brief. Favor no when the conversation already has momentum, a straightforward response is enough, or an addition would repeat existing instructions. Weigh the risk of making the character feel directed, over-scripted, or less spontaneous. Do not invent a reason to intervene merely because you were asked. Additions persist; more direction is not inherently better.",
  writerPrompt:"You are the room's improv collaborator. Write a concise persistent addition to the selected character's system prompt, serving the creative intentions below and the visible story. You may invent freely. Give the character something playable that expands the scene, rather than scripting their next spoken reply. Work with their existing instructions and previous additions; avoid needless repetition. Return only the addition, at most 2000 characters. It will remain in their system prompt until the operator changes or removes it."};
export function validateImprov(s:State){
  const c=s.improv;
  if(c!==undefined&& (!c||typeof c.enabled!=='boolean'||!['opengateway','together'].includes(c.provider)||typeof c.model!=='string'||!c.model.trim()||c.model.length>200||!['jevPrompt','writerPrompt'].every(k=>typeof (c as any)[k]==='string'&&(c as any)[k].trim()&&(c as any)[k].length<=20000)||!Number.isFinite(c.temperature)||c.temperature<0||c.temperature>2||!Number.isFinite(c.threshold)||c.threshold<0||c.threshold>1||!Number.isInteger(c.cooldown)||c.cooldown<0||c.cooldown>50||!Number.isInteger(c.maxPerTen)||c.maxPerTen<1||c.maxPerTen>10||!Number.isInteger(c.budgetMs)||c.budgetMs<500||c.budgetMs>30000))throw Error('Invalid improv settings');
  for(const character of Object.values(s.characters))if(character.additions!==undefined&&(!Array.isArray(character.additions)||character.additions.some(a=>typeof a.id!=='string'||typeof a.text!=='string'||!a.text.trim()||a.text.length>2000||typeof a.turnId!=='string'||typeof a.at!=='string'||!Number.isInteger(a.afterTurns)||a.afterTurns<0)||new Set(character.additions.map(a=>a.id)).size!==character.additions.length))throw Error('Invalid prompt additions');
}
// Hard deadline includes reading the response. Late providers cannot attach a result after the fallback.
async function bounded<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{
  signal.throwIfAborted();let abort:()=>void=()=>{};
  try{return await Promise.race([work,new Promise<never>((_,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();})]);}
  finally{signal.removeEventListener('abort',abort);}
}
export async function prepareImprov(store:Store,s:State,person:string,context:{system:string;transcript:string;parts:any[];visibleMessageIds:string[]},meta:{branch:string;revision:string;turnId:string},signal:AbortSignal,transport:typeof fetch){
  const c=s.improv;if(!c?.enabled)return null;
  const start=Date.now(),count=s.messages.filter(m=>m.source==='generated').length,own=s.characters[person].additions||[];
  const record={id:meta.turnId,...meta,person,at:new Date().toISOString(),config:c,visibleMessageIds:context.visibleMessageIds};
  store.put('improv-decisions',meta.turnId,record);
  const finish=(status:string,extra:object={})=>store.put('improv-results',meta.turnId,{id:meta.turnId,...meta,person,status,latencyMs:Date.now()-start,...extra});
  const last=own.at(-1);
  if(last&&count-last.afterTurns<=c.cooldown){finish('cooldown');return null;}
  const recent=Object.values(s.characters).flatMap(p=>p.additions||[]).filter(a=>count-a.afterTurns<10);
  if(recent.length>=c.maxPerTen){finish('rate-limit');return null;}
  const deadline=AbortSignal.any([signal,AbortSignal.timeout(c.budgetMs)]);
  async function call(stage:string,endpoint:string,body:any,keyName:string){
    const key=id();store.put('improv-requests',key,{id:key,...meta,person,stage,endpoint,body,at:new Date().toISOString()});
    let raw:string|null=null;
    try{
      const token=process.env[keyName];if(!token)throw Error(`${keyName} is missing`);
      deadline.throwIfAborted();
      const res=await bounded(transport(endpoint,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:deadline}).then(async response=>({ok:response.ok,status:response.status,raw:await response.text()})),deadline);
      raw=res.raw;if(!res.ok)throw Error(`${stage} returned HTTP ${res.status}`);
      const parsed=JSON.parse(raw);store.put('improv-outcomes',key,{id:key,...meta,person,stage,status:'completed',raw,usage:parsed.usage??null,at:new Date().toISOString()});return parsed;
    }catch(e:any){store.put('improv-outcomes',key,{id:key,...meta,person,stage,status:deadline.aborted?'canceled':'failed',raw,error:e.message,at:new Date().toISOString()});throw e;}
  }
  try{
    const gate=await call('jev','https://api.typesafe.ai/v1/systemone',{model:'jev-latest',state:{character:s.characters[person].label||person,system:context.system,transcript:context.transcript,writer_brief:c.writerPrompt,images:context.parts.length?'Images are attached to the conversation; pixels unavailable to Jev.':'none'},questions:{intervene:{type:'noul',instructions:c.jevPrompt}}},'TYPESAFE_API_KEY');
    const probability=gate.answers?.intervene?.noul;
    if(typeof probability!=='number'||!Number.isFinite(probability)||probability<0||probability>1)throw Error('Jev did not return a valid intervention probability');
    if(probability<c.threshold){finish('declined',{probability});return null;}
    const payload=`Selected character: ${s.characters[person].label||person}\n\nCurrent system prompt:\n${context.system}\n\nVisible conversation:\n${context.transcript}`;
    const output=await call('writer',ENDPOINTS[c.provider],{model:c.model,temperature:c.temperature,max_tokens:700,...(c.provider==='opengateway'?{thinking:{type:'disabled'}}:{}),messages:[{role:'system',content:c.writerPrompt},{role:'user',content:context.parts.length?[{type:'text',text:payload},...context.parts]:payload}]},c.provider==='together'?'TOGETHER_API_KEY':'OPENGATEWAY_API_KEY');
    deadline.throwIfAborted();const text=output.choices?.[0]?.message?.content;
    if(typeof text!=='string'||!text.trim()||text.trim().length>2000||output.choices?.[0]?.finish_reason==='length')throw Error('Writer must return a complete, nonempty addition of at most 2000 characters');
    const addition:Addition={id:id(),text:text.trim(),turnId:meta.turnId,at:new Date().toISOString(),afterTurns:count};
    finish('prepared',{probability,addition});return addition;
  }catch(e:any){finish(signal.aborted?'canceled':deadline.aborted?'timed-out':'failed',{error:e.message});return null;}
}

export function recoverImprov(store:Store){
  const outcomes=new Set(store.list('improv-outcomes').map(r=>r.id));
  for(const r of store.list('improv-requests'))if(!outcomes.has(r.id))store.put('improv-outcomes',r.id,{id:r.id,branch:r.branch,turnId:r.turnId,stage:r.stage,status:'interrupted',error:'Server restarted; no automatic retry'});
  const results=new Set(store.list('improv-results').map(r=>r.id));
  for(const r of store.list('improv-decisions'))if(!results.has(r.id))store.put('improv-results',r.id,{id:r.id,branch:r.branch,person:r.person,turnId:r.turnId,status:'interrupted',error:'Server restarted; no automatic retry'});
}
