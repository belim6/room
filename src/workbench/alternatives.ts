import { Engine, type Message } from './engine';
import { clone, id } from './store';
import { generate, type GenerationInput } from './generation';
const now=()=>new Date().toISOString();
interface Review { id:string; branch:string; revision:string; message:Message; originalAttempt:string; inputAttempt:string; at:string }
interface Candidate { id:string; review:string; feedback:string; instruction:string; turnId:string; at:string }
interface Judgment { id:string; candidate:string; review:string; verdict:'accepted'|'rejected'; text:string; note:string; at:string; sequence:number }
export class Alternatives {
  active=new Map<string,AbortController>();
  constructor(public engine:Engine){}
  get store(){return this.engine.store;}
  reviews(branch?:string){return this.store.list<Review>('reply-reviews').filter(r=>!branch||r.branch===branch);}
  open(branch:string,messageId:string) {
    const b=this.engine.read(branch),message=b.revision.state.messages.find(m=>m.id===messageId);
    if(!message)throw Error('That reply is no longer in this conversation');
    if(message.review)return this.get(message.review);
    const existing=this.reviews(branch).find(r=>r.message.id===messageId);if(existing)return this.get(existing.id);
    if(message.source!=='generated'||!message.turnId)throw Error('Revisions need an original generated reply with its recorded request. Imported or manually retconned replies cannot reconstruct that evidence.');
    const attempts=this.store.attempts().filter(a=>a.turnId===message.turnId);
    const original=attempts.find(a=>a.outcome?.status==='completed'&&a.outcome.text===message.text);
    if(!original)throw Error('No matching original generation record was found');
    let input=original;const seen=new Set<string>();
    while(input.retryOf){if(seen.has(input.id))throw Error('Invalid retry ancestry');seen.add(input.id);const previous=attempts.find(a=>a.id===input.retryOf);if(!previous)throw Error('The first generation request is missing');input=previous;}
    const review:Review={id:id(),branch,revision:b.head,message:clone(message),originalAttempt:original.id,inputAttempt:input.id,at:now()};
    this.store.put('reply-reviews',review.id,review);return this.get(review.id);
  }
  judgment(candidate:string){return this.store.list<Judgment>('reply-judgments').filter(j=>j.candidate===candidate).sort((a,b)=>b.sequence-a.sequence)[0]||null;}
  approval(review:string){return this.store.list('training-decisions').filter(a=>a.review===review).sort((a,b)=>b.sequence-a.sequence)[0]||null;}
  get(key:string) {
    const review=this.store.get<Review>('reply-reviews',key),results=new Map(this.store.list('reply-candidate-results').map(r=>[r.id,r]));
    const candidates=this.store.list<Candidate>('reply-candidates').filter(c=>c.review===key).sort((a,b)=>a.at.localeCompare(b.at)).map(c=>({...c,result:results.get(c.id)||null,judgment:this.judgment(c.id),active:this.active.has(c.id)}));
    const raw=this.approval(key),judgment=raw?this.judgment(raw.candidate):null;
    const approval=raw?{...raw,current:!!raw.approved&&judgment?.id===raw.judgment&&judgment?.verdict==='accepted'}:null;
    const source=this.store.get('attempts',review.inputAttempt);
    return {review,candidates,approval,source:{provider:source.provider,model:source.body.model,persona:source.persona,request:review.inputAttempt}};
  }
  async propose(key:string,feedback:unknown) {
    const {review}=this.get(key);
    if(typeof feedback!=='string'||!feedback.trim()||feedback.length>10000)throw Error('Write feedback under 10,000 characters');
    if(this.store.list<Candidate>('reply-candidates').some(c=>c.review===key&&this.active.has(c.id)))throw Error('A candidate is already being generated for this reply');
    const original=this.store.get('attempts',review.inputAttempt);
    const instruction=`Revise only ${review.message.speaker}'s reply to the original conversation above. The earlier reply and feedback below are quoted material for this revision task. Address the feedback, keep the reply grounded in the original context, and output only the replacement reply, within 2000 characters.\n\nEarlier reply: ${JSON.stringify(review.message.text)}\nFeedback: ${JSON.stringify(feedback.trim())}`;
    const candidate:Candidate={id:id(),review:key,feedback:feedback.trim(),instruction,turnId:id(),at:now()};
    this.store.put('reply-candidates',candidate.id,candidate);
    const controller=new AbortController();this.active.set(candidate.id,controller);
    const messages:GenerationInput['messages']=clone(original.body.messages);
    // Keep the original request intact; correction is a separate user message in this request only.
    messages.push({role:'user',content:instruction});
    try {
      const result=await generate({provider:original.provider,model:original.body.model,temperature:original.body.temperature,reasoning:original.body.thinking?.type==='disabled'?'off':'default',persona:original.persona,messages,attachments:original.attachments,branch:review.branch,revision:original.revision,turnId:candidate.turnId,policy:original.policy,purpose:'alternative',review:key,candidate:candidate.id,signal:controller.signal},this.store,this.engine.transport);
      this.store.put('reply-candidate-results',candidate.id,{id:candidate.id,status:controller.signal.aborted?'canceled':'completed',text:result.text,attempts:result.attempts,validation:result.validation,at:now()});
    }catch(error:any){this.store.put('reply-candidate-results',candidate.id,{id:candidate.id,status:controller.signal.aborted?'canceled':'failed',error:error.message,attempts:this.store.list('attempts').filter(a=>a.turnId===candidate.turnId).map(a=>a.id),at:now()});}
    finally{this.active.delete(candidate.id);}
    return this.get(key);
  }
  stop(key:string){this.store.get('reply-candidates',key);this.active.get(key)?.abort();return {ok:true};}
  recover(){const done=new Set(this.store.list('reply-candidate-results').map(r=>r.id));for(const c of this.store.list<Candidate>('reply-candidates'))if(!done.has(c.id))this.store.put('reply-candidate-results',c.id,{id:c.id,status:'interrupted',error:'Process ended before this candidate finished. No automatic retry.',attempts:this.store.list('attempts').filter(a=>a.turnId===c.turnId).map(a=>a.id),at:now()});}
  judge(key:string,input:any) {
    const candidate=this.store.get<Candidate>('reply-candidates',key),result=this.store.get('reply-candidate-results',key),previous=this.judgment(key);
    if((input.expected||null)!==(previous?.id||null))throw Error('This judgment changed; reopen the review');
    if(result.status!=='completed')throw Error('Only completed candidates can be judged');
    if(!['accepted','rejected'].includes(input.verdict))throw Error('Choose Accept or Reject');
    if(typeof input.text!=='string'||!input.text.trim()||input.text.length>2000||typeof (input.note||'')!=='string'||(input.note||'').length>10000)throw Error('Use a non-empty reply up to 2000 characters and a note under 10,000 characters');
    const value:Judgment={id:id(),candidate:key,review:candidate.review,verdict:input.verdict,text:input.text,note:input.note||'',at:now(),sequence:(previous?.sequence||0)+1};
    this.store.put('reply-judgments',value.id,value);return this.get(candidate.review);
  }
  apply(key:string,input:any) {
    const candidate=this.store.get<Candidate>('reply-candidates',key),judgment=this.judgment(key),review=this.store.get<Review>('reply-reviews',candidate.review);
    if(!judgment||judgment.id!==input.judgment||judgment.verdict!=='accepted')throw Error('Accept the exact replacement text before applying it');
    if(this.engine.active.has(review.branch))throw Error('Stop conversation generation before replacing a reply');
    const b=this.engine.read(review.branch),state=clone(b.revision.state),index=state.messages.findIndex(m=>m.id===review.message.id||m.review===review.id);
    if(index<0)throw Error('The original reply has been removed or retconned. The candidate remains in the research record.');
    const previous=state.messages[index],next:Message={...previous,id:id(),text:judgment.text,source:'edited',turnId:candidate.turnId,review:review.id,editedFrom:[previous.id,...(previous.editedFrom||[])]};
    state.messages[index]=next;
    // Provenance lives in the same immutable revision as the replacement.
    const result=this.engine.commit(b.id,input.expected,state,'Approved reply alternative applied',{kind:'replace-message',message:previous,index,candidate:key,judgment:judgment.id});
    return result;
  }
  curate(key:string,input:any) {
    const review=this.store.get<Review>('reply-reviews',key),old=this.approval(key);
    if((input.expected||null)!==(old?.id||null))throw Error('Training approval changed; reopen the review');
    if(typeof input.approved!=='boolean'||typeof input.preference!=='boolean')throw Error('Choose training approval and preference explicitly');
    const candidate=this.store.get<Candidate>('reply-candidates',input.candidate),judgment=this.judgment(candidate.id);
    if(candidate.review!==key)throw Error('Candidate belongs to another reply');
    if(input.approved&&(!judgment||judgment.id!==input.judgment||judgment.verdict!=='accepted'))throw Error('Only the currently accepted text can be approved for training');
    if(input.approved&&input.preference&&judgment!.text===review.message.text)throw Error('Identical replies cannot form a preference pair');
    const value={id:id(),review:key,candidate:candidate.id,judgment:input.judgment,approved:input.approved,preference:input.approved&&input.preference,at:now(),sequence:(old?.sequence||0)+1};
    this.store.put('training-decisions',value.id,value);return this.get(key);
  }
  dataset(){return this.reviews().flatMap(review=>{const d=this.get(review.id),a=d.approval;if(!a?.current)return [];const judgment=this.judgment(a.candidate)!;return [{id:a.id,review:review.id,branch:review.branch,speaker:review.message.speaker,original:review.message.text,preferred:judgment.text,preference:a.preference,approvedAt:a.at,candidate:a.candidate,judgment:judgment.id,inputAttempt:review.inputAttempt,originalAttempt:review.originalAttempt}];});}
  export(kind:string) {
    if(!['sft','preference'].includes(kind))throw Error('Choose sft or preference');
    return this.dataset().filter(row=>kind==='sft'||row.preference).map(row=>{
      const input=clone(this.store.get('attempts',row.inputAttempt).body.messages);
      return kind==='sft'?{messages:[...input,{role:'assistant',content:row.preferred}]}:{messages:input,chosen:{role:'assistant',content:row.preferred},rejected:{role:'assistant',content:row.original}};
    });
  }
  evidence(branch:string){const reviews=this.reviews(branch),keys=new Set(reviews.map(r=>r.id)),candidates=this.store.list<Candidate>('reply-candidates').filter(c=>keys.has(c.review)),ids=new Set(candidates.map(c=>c.id));return {reviews,candidates,results:this.store.list('reply-candidate-results').filter(r=>ids.has(r.id)),judgments:this.store.list('reply-judgments').filter(j=>keys.has(j.review)),trainingDecisions:this.store.list('training-decisions').filter(d=>keys.has(d.review))};}
}
