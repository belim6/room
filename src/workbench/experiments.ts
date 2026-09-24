import { runInNewContext } from 'node:vm';
import { Engine, validateState, type State, type Character, type Revision } from './engine';
import { clone, id } from './store';
import { reasoningOf } from './generation';
import { stateChanges } from './changes';
import type { PersonaName } from '../personas/personas';
type Patch = Partial<Pick<State,'system'|'participants'|'shadow'|'policy'|'human'>> & {characters?: Partial<Record<PersonaName,Partial<Character>>>};
export interface Condition { key: string; label: string; control?: boolean; patch: Patch }
interface OutcomeRule { pattern: string; flags?: string; highlight?: Record<string,string> }
export interface Experiment { id: string; version: string; sequence: number; name: string; createdAt: string; question: string; prediction: string; base: {branch:string;revision:string}; speaker: PersonaName; conditions: Condition[]; outcome?: OutcomeRule; retrospective?: boolean; lockedAt?: string; parent?: string }
interface Trial { id: string; experiment: string; condition: string; index: number; branch: string; turnId: string; at: string; status: string; batch?: string; attached?: boolean; error?: string; sequence?: number }
const now = () => new Date().toISOString();
export function applyPatch(base: State, patch: Patch): State {
  if(!patch || typeof patch!=='object' || Array.isArray(patch))throw Error('A condition patch must be an object');
  const next=clone(base);
  for(const [key,value] of Object.entries(patch)) {
    if(key==='characters') {
      if(!value || typeof value!=='object' || Array.isArray(value))throw Error('Invalid character patch');
      for(const [name,fields] of Object.entries(value)) {
        if(!Object.prototype.hasOwnProperty.call(next.characters,name) || !fields || typeof fields!=='object' || Array.isArray(fields))throw Error('Invalid character patch');
        for(const [field,v] of Object.entries(fields)) {
          if(!['prompt','memory','provider','model','temperature'].includes(field))throw Error('Unknown character field');
          (next.characters as any)[name][field]=v;
        }
      }
    } else {
      if(!['system','participants','shadow','policy','human'].includes(key))throw Error('Only settings may be patched');
      (next as any)[key]=clone(value);
    }
  }
  validateState(next);return next;
}
export function extractOutcome(text: string, rule?: OutcomeRule): {value:string|null;error?:string} {
  if(!rule)return {value:null};
  try {
    // User expressions have a hard execution limit; a bad regex must not block Stop.
    const value=runInNewContext(`let value=null; for(const m of text.matchAll(new RegExp(pattern,flags))) if(m[1]!==undefined)value=m[1]; value;`,
      {text,pattern:rule.pattern,flags:[...new Set((rule.flags||'')+'g')].join('')},{timeout:30});
    return {value};
  } catch { return {value:null,error:'Outcome expression could not finish. Add a manual label.'}; }
}
export class Experiments {
  active = new Map<string,{stopped:boolean;trials:Trial[];done:Promise<void>}>();
  constructor(public engine: Engine) {}
  get store(){return this.engine.store;}
  get(key:string): Experiment {
    const original=this.store.get<Experiment>('experiments',key);
    const versions=this.store.list<Experiment>('experiment-revisions').filter(e=>e.id===key).sort((a,b)=>b.sequence-a.sequence);
    const lock=this.store.list('experiment-locks').find(e=>e.id===key);
    const result=lock ? [original,...versions].find(e=>e.version===lock.version)! : versions[0]||original;
    return {...result,...(lock?{lockedAt:lock.at,retrospective:lock.retrospective}: {})};
  }
  list(){return this.store.list<Experiment>('experiments').map(e=>this.get(e.id));}
  // Branched drafts start with blank intent; it must be written before the first run.
  private validate(input: any, intent=true) {
    for(const key of intent?['name','question','prediction']:['name'])if(typeof input[key]!=='string'||!input[key].trim()||input[key].length>(key==='name'?120:20000))throw Error(`Write an experiment ${key}`);
    const b=this.engine.read(input.base?.branch);
    let cursor:string|null=b.head;
    while(cursor&&cursor!==input.base?.revision)cursor=this.store.get<Revision>('revisions',cursor).parent;
    if(!cursor)throw Error('Choose a recorded checkpoint of the base conversation');
    const base=this.store.get<Revision>('revisions',cursor).state;
    if(!Array.isArray(input.conditions)||input.conditions.length<1||input.conditions.length>6||input.conditions.filter((c:any)=>c.control===true).length!==1)throw Error('Use 1–6 conditions and exactly one control');
    const keys=new Set();
    for(const c of input.conditions) {
      if(typeof c.key!=='string'||!/^[A-Za-z0-9_-]{1,50}$/.test(c.key)||keys.has(c.key)||typeof c.label!=='string'||!c.label.trim()||c.label.length>120)throw Error('Each condition needs a unique key and label');
      keys.add(c.key);
      const effective=applyPatch(base,c.patch);
      if(!effective.participants.includes(input.speaker))throw Error('The measured speaker must participate in every condition');
    }
    if(input.outcome) {
      const r=input.outcome;
      if(typeof r.pattern!=='string'||r.pattern.length>500||typeof (r.flags||'')!=='string'||!/^[gimsu]*$/.test(r.flags||''))throw Error('Invalid outcome expression');
      new RegExp(r.pattern,r.flags);
      if(r.highlight&&(typeof r.highlight!=='object'||Array.isArray(r.highlight)||Object.entries(r.highlight).some(([k,v])=>k.length>100||typeof v!=='string'||v.length>100)))throw Error('Invalid outcome tags');
    }
  }
  create(input:any) {
    this.validate(input);const key=id();
    const result:Experiment={id:key,version:id(),sequence:0,name:input.name.trim(),createdAt:now(),question:input.question,prediction:input.prediction,base:clone(input.base),speaker:input.speaker,conditions:clone(input.conditions),...(input.outcome?{outcome:clone(input.outcome)}:{}),retrospective:input.retrospective===true};
    this.store.put('experiments',key,result);return result;
  }
  edit(key:string,input:any) {
    const old=this.get(key);
    if(old.lockedAt)throw Error('This experiment is locked. Record later thoughts in its notebook.');
    if(input.expected!==old.version)throw Error('Experiment changed; reopen before editing');
    this.validate(input);
    const next={...old,name:input.name.trim(),question:input.question,prediction:input.prediction,base:clone(input.base),speaker:input.speaker,conditions:clone(input.conditions),outcome:clone(input.outcome),version:id(),sequence:old.sequence+1};
    this.store.put('experiment-revisions',next.version,next);return next;
  }
  branch(key:string,input:any) {
    const from=this.get(key),name=typeof input?.name==='string'&&input.name.trim()?input.name.trim():`${from.name} · branch`;
    const draft={name,question:'',prediction:'',base:clone(from.base),speaker:from.speaker,conditions:clone(from.conditions),...(from.outcome?{outcome:clone(from.outcome)}:{})};
    this.validate(draft,false);
    const result:Experiment={id:id(),version:id(),sequence:0,createdAt:now(),...draft,parent:key,retrospective:false};
    this.store.put('experiments',result.id,result);return result;
  }
  parentOf(key:string):string|null {
    const e=this.get(key);if(e.parent)return e.parent;
    return this.store.list('experiment-links').filter(l=>l.experiment===key).sort((a,b)=>b.sequence-a.sequence)[0]?.parent||null;
  }
  // Lineage is metadata beside the frozen design, so locked experiments may be linked.
  link(key:string,input:any) {
    const e=this.get(key),parent=input?.parent;
    if(e.parent)throw Error('This experiment was branched; its parent is part of its record');
    if(typeof parent!=='string')throw Error('Choose a parent experiment');
    this.get(parent);
    for(let cursor:string|null=parent;cursor;cursor=this.parentOf(cursor))if(cursor===key)throw Error('That link would make a cycle');
    const previous=this.store.list('experiment-links').filter(l=>l.experiment===key);
    const value={id:id(),experiment:key,parent,at:now(),sequence:previous.length+1};this.store.add('experiment-links',value);return value;
  }
  designDiff(from:Experiment,to:Experiment) {
    const state=(e:Experiment,c:Condition)=>applyPatch(this.store.get<Revision>('revisions',e.base.revision).state,c.patch);
    const last=(e:Experiment)=>this.store.get<Revision>('revisions',e.base.revision).state.messages.at(-1)||null;
    const conditions=[
      ...from.conditions.filter(c=>!to.conditions.some(x=>x.key===c.key)).map(c=>({key:c.key,label:c.label,change:'removed'})),
      ...to.conditions.filter(c=>!from.conditions.some(x=>x.key===c.key)).map(c=>({key:c.key,label:c.label,change:'added'})),
      ...to.conditions.flatMap(c=>{const old=from.conditions.find(x=>x.key===c.key);if(!old)return [];
        const changes=stateChanges(state(from,old),state(to,c)),control=!!old.control!==!!c.control;
        return changes.settings.length||Object.values(changes.conversation).some(v=>Array.isArray(v)?v.length:typeof v==='object'?Object.keys(v).length:v)||control?[{key:c.key,label:c.label,change:'changed',changes,...(control?{control:{before:!!old.control,after:!!c.control}}:{})}]:[];})];
    return {base:from.base.revision===to.base.revision?null:{before:{...from.base,lastMessage:last(from)},after:{...to.base,lastMessage:last(to)}},
      speaker:from.speaker===to.speaker?null:{before:from.speaker,after:to.speaker},conditions,
      outcome:JSON.stringify(from.outcome||null)===JSON.stringify(to.outcome||null)?null:{before:from.outcome||null,after:to.outcome||null}};
  }
  lineage(key:string) {
    const all=this.list(),parents=new Map(all.map(e=>[e.id,this.parentOf(e.id)]));
    const ancestors:string[]=[];for(let cursor=parents.get(key);cursor&&!ancestors.includes(cursor);cursor=parents.get(cursor))ancestors.unshift(cursor);
    const descendants:string[]=[],visit=(p:string)=>all.filter(e=>parents.get(e.id)===p).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).forEach(e=>{descendants.push(e.id);visit(e.id);});visit(key);
    const designs=new Map<string,string>();
    const median=(v:number[])=>{const s=[...v].sort((a,b)=>a-b),m=s.length>>1;return s.length?(s.length%2?s[m]:(s[m-1]+s[m])/2):null;};
    // Counts stay per experiment: identical designs are aligned, never pooled.
    const experiments=[...ancestors,key,...descendants].map(k=>{
      const e=this.get(k),results=this.results(e),base=this.store.get<Revision>('revisions',e.base.revision).state;
      return {id:e.id,name:e.name,lockedAt:e.lockedAt||null,retrospective:!!e.retrospective,parent:parents.get(k)||null,current:k===key,conditions:e.conditions.map(c=>{
        const signature=JSON.stringify([e.speaker,applyPatch(base,c.patch)]);if(!designs.has(signature))designs.set(signature,`${c.key} · ${e.name}`);
        const done=results.filter(t=>t.condition===c.key&&t.status==='completed'),counts:Record<string,number>={},tags:Record<string,number>=Object.fromEntries(Object.values(e.outcome?.highlight||{}).map(t=>[t,0]));
        for(const t of done){const v=t.effectiveOutcome||'Unlabelled';counts[v]=(counts[v]||0)+1;if(t.tag)tags[t.tag]=(tags[t.tag]||0)+1;}
        const tokens=done.map(t=>t.completionTokens).filter((n):n is number=>typeof n==='number'),times=done.map(t=>t.measuredAt).filter(Boolean).sort();
        return {key:c.key,label:c.label,control:!!c.control,design:designs.get(signature)!,n:done.length,counts,tags,medianTokens:median(tokens),tokenRange:tokens.length?[Math.min(...tokens),Math.max(...tokens)]:null,window:times.length?[times[0],times.at(-1)]:null};
      })};
    });
    return experiments;
  }
  private lock(e:Experiment, retrospective=false) {
    if(!e.lockedAt)this.store.put('experiment-locks',e.id,{id:e.id,version:e.version,at:now(),retrospective:!!e.retrospective||retrospective});
  }
  trials(key:string):Trial[] {
    const events=this.store.list('experiment-trial-events');
    return this.store.list<Trial>('experiment-trials').filter(t=>t.experiment===key).map(t=>{
      const history=events.filter(e=>e.trial===t.id).sort((a,b)=>b.sequence-a.sequence);
      return {...t,...(history[0]?.value||{}),sequence:history[0]?.sequence||0};
    }).sort((a,b)=>a.condition.localeCompare(b.condition)||a.index-b.index);
  }
  private event(t:Trial,value:Partial<Trial>) {
    const sequence=(t.sequence||0)+1;this.store.add('experiment-trial-events',{trial:t.id,at:now(),sequence,value:{...t,...value,sequence}});Object.assign(t,value,{sequence});
  }
  attach(key:string,input:any) {
    const e=this.get(key),condition=e.conditions.find(c=>c.key===input.condition);
    if(!condition)throw Error('Unknown condition');
    if(this.active.has(key))throw Error('Stop the batch before attaching trials');
    const b=this.engine.read(input.branch);
    if(b.fork!==e.base.revision)throw Error('The trial must start at this experiment’s frozen checkpoint');
    const messages=b.revision.state.messages;
    const reply=input.turnId?messages.find(m=>m.turnId===input.turnId&&m.source==='generated'): [...messages].reverse().find(m=>m.source==='generated'&&m.speaker===e.speaker);
    if(!reply?.turnId||reply.speaker!==e.speaker)throw Error('Choose an original generated reply by the measured speaker');
    const turn=this.store.get('turns',reply.turnId);
    if(turn.branch!==b.id||turn.status!=='attached')throw Error('That turn was not attached to this trial branch');
    const attempts=this.store.attempts().filter(a=>a.turnId===reply.turnId);
    if(!attempts.length)throw Error('This turn has no recorded request');
    const requested=this.store.get<Revision>('revisions',attempts[0].revision).state;
    if(JSON.stringify(requested)!==JSON.stringify(applyPatch(this.store.get<Revision>('revisions',e.base.revision).state,condition.patch)))throw Error('The recorded turn input does not match this condition and checkpoint');
    const existing=this.trials(key);if(existing.some(t=>t.turnId===reply.turnId))throw Error('This turn is already attached');
    this.lock(e,true);
    const t:Trial={id:id(),experiment:key,condition:condition.key,index:1+Math.max(0,...existing.filter(t=>t.condition===condition.key).map(t=>t.index)),branch:b.id,turnId:reply.turnId,at:now(),status:'completed',attached:true};
    this.store.put('experiment-trials',t.id,t);return t;
  }
  run(key:string,perCondition:number,expected?:string) {
    if(!Number.isInteger(perCondition)||perCondition<1||perCondition>50)throw Error('Choose 1–50 trials per condition');
    if(this.active.has(key))throw Error('This experiment is already running');
    const e=this.get(key);if(expected!==e.version)throw Error('Experiment changed; review it before running');
    // Validate before spending; deleted bases must be restored explicitly.
    this.validate(e);this.lock(e);
    const base=this.store.get<Revision>('revisions',e.base.revision).state,batch=id(),trials:Trial[]=[];
    const old=this.trials(key);
    for(const c of e.conditions) {
      const start=Math.max(0,...old.filter(t=>t.condition===c.key).map(t=>t.index));
      for(let n=1;n<=perCondition;n++) {
        const trialId=id(),index=start+n;
        let branch=this.engine.create(`${e.name} · ${c.key} · trial ${index}`,base,e.base.branch,e.base.revision,undefined,{experiment:key,trial:trialId});
        branch=this.engine.commit(branch.id,branch.head,applyPatch(base,c.patch),`Experiment condition ${c.key}`);
        const t:Trial={id:trialId,experiment:key,condition:c.key,index,branch:branch.id,turnId:id(),at:now(),status:'queued',batch};
        this.store.put('experiment-trials',t.id,t);trials.push(t);
      }
    }
    const run={stopped:false,trials,done:Promise.resolve()};this.active.set(key,run);
    // All intended trials are durable before the first request can be dispatched.
    run.done=Promise.all(e.conditions.map(async c=>{
      for(const t of trials.filter(t=>t.condition===c.key)) {
        if(run.stopped){this.event(t,{status:'canceled',error:'Stopped before dispatch'});continue;}
        try {
          for(let retry=0;retry<=2;retry++) {
            if(run.stopped){this.event(t,{status:'canceled'});break;}
            if(retry)this.event(t,{turnId:id()});
            this.event(t,{status:'running'});
            try {
              const b=this.engine.read(t.branch);
              await this.engine.turn(b.id,b.head,e.speaker,{id:key,index:t.index,count:Math.max(...trials.filter(x=>x.condition===c.key).map(x=>x.index))},{turnId:t.turnId});
              const turn=this.store.get('turns',t.turnId);
              this.event(t,{status:turn.status==='attached'?'completed':turn.status==='canceled'?'canceled':'failed',...(turn.status==='detached'?{error:'Branch changed while the trial was running'}:{})});break;
            } catch(error:any) {
              if(!run.stopped&&error.name==='TimeoutError'&&retry<2)continue;
              this.event(t,{status:run.stopped?'canceled':'failed',error:error.message});break;
            }
          }
        } catch(error:any){this.event(t,{status:'failed',error:error.message});}
      }
    })).then(()=>{}).finally(()=>this.active.delete(key));
    return {batch,trials:trials.length};
  }
  stop(key:string) {
    this.get(key);const run=this.active.get(key);if(run){run.stopped=true;for(const t of run.trials)this.engine.cancel(t.branch);}return {ok:true};
  }
  recover() {
    for(const e of this.list())for(const t of this.trials(e.id).filter(t=>['queued','running'].includes(t.status))) {
      const turn=this.store.list('turns').find(r=>r.id===t.turnId);
      // A crash between committing the reply and recording its turn still retains that reply.
      const attached=this.store.list<Revision>('revisions').some(r=>r.branch===t.branch&&r.state.messages.some(m=>m.turnId===t.turnId&&m.source==='generated'));
      this.event(t,{status:turn?.status==='attached'||attached?'completed':'canceled',error:attached?undefined:'Process interrupted; no automatic retry'});
    }
  }
  label(key:string,trial:string,input:any) {
    if(!this.trials(key).some(t=>t.id===trial))throw Error('Unknown trial');
    for(const k of ['outcome','tag','note'])if(input[k]!=null&&(typeof input[k]!=='string'||input[k].length>(k==='note'?20000:200)))throw Error('Invalid label');
    if(typeof input.outcome!=='string'||!input.outcome.trim())throw Error('Write an outcome');
    const previous=this.store.list('experiment-labels').filter(l=>l.trial===trial);
    const value={id:id(),trial,outcome:input.outcome,tag:input.tag||null,note:input.note||'',at:now(),sequence:previous.length+1};this.store.add('experiment-labels',value);return value;
  }
  results(e:Experiment) {
    const key=e.id;
    const labels=this.store.list('experiment-labels'),attempts=this.store.attempts(),events=this.store.list('experiment-trial-events'),turns=this.store.list('turns');
    return this.trials(key).map(t=>{
      const turnIds=new Set([t.turnId,...events.filter(r=>r.trial===t.id).map(r=>r.value.turnId)]);
      const evidence=attempts.filter(a=>turnIds.has(a.turnId));
      const turn=turns.find(r=>r.id===t.turnId);
      const revision=turn?.revision?this.store.get<Revision>('revisions',turn.revision):this.store.list<Revision>('revisions').filter(r=>r.branch===t.branch&&r.state.messages.some(m=>m.turnId===t.turnId&&m.source==='generated')).sort((a,b)=>a.at.localeCompare(b.at))[0];
      const message=revision?.state.messages.find(m=>m.turnId===t.turnId);
      const measured=[...evidence].filter(a=>a.turnId===t.turnId&&a.outcome?.status==='completed').sort((a,b)=>a.at.localeCompare(b.at)).at(-1),outcome=measured?.outcome;
      const reply=message?.text||outcome?.text||'',extracted=extractOutcome(reply,e.outcome);
      const manual=labels.filter(l=>l.trial===t.id).sort((a,b)=>b.sequence-a.sequence)[0]||null;
      const effectiveOutcome=manual?.outcome??extracted.value,tag=manual?manual.tag:(e.outcome?.highlight?.[effectiveOutcome||'']||null);
      return {...t,reply,messageId:message?.id||null,extracted:extracted.value,extractionError:extracted.error,manual,effectiveOutcome,tag,reasoning:reasoningOf(outcome),completionTokens:outcome?.usage?.completion_tokens??null,measuredAt:measured?.at||null,latencyMs:evidence.length?evidence.reduce((n,a)=>n+(a.outcome?.latencyMs||0),0):null,tokens:evidence.some(a=>a.outcome?.usage?.total_tokens!=null)?evidence.reduce((n,a)=>n+(a.outcome?.usage?.total_tokens||0),0):null,attempts:evidence.map(a=>a.id)};
    });
  }
  detail(key:string) {
    const e=this.get(key),base=this.store.get<Revision>('revisions',e.base.revision),control=e.conditions.find(c=>c.control)!,trials=this.results(e),parent=this.parentOf(key),from=parent?this.get(parent):null;
    return {experiment:e,parent:from?{id:from.id,name:from.name,linked:!e.parent}:null,designDiff:from?this.designDiff(from,e):null,lineage:this.lineage(key),base:{...e.base,lastMessage:base.state.messages.at(-1)||null,state:base.state},active:this.active.has(key),
      conditions:e.conditions.map(c=>({...c,changes:stateChanges(applyPatch(base.state,control.patch),applyPatch(base.state,c.patch)),character:applyPatch(base.state,c.patch).characters[e.speaker],shadow:applyPatch(base.state,c.patch).shadow,policy:applyPatch(base.state,c.patch).policy})),trials,observations:this.store.list('observations').filter(o=>o.experiment===key)};
  }
}
