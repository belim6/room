// Transcript goldens were captured with the unchanged stage 1 source at d2dddd6.
// Perspective goldens are independently specified role/content sequences.
import { Store } from '../src/workbench/store';
import { Engine, initialState } from '../src/workbench/engine';
import { DEFAULT_FRAME } from '../src/speakerTurn';
export const transcriptCases=['legacy-absent','legacy-default','legacy-custom','legacy-blank','v2-absent','v2-default','v2-custom','v2-blank'];
export function historyState(store:Store) {
  for(const a of [{id:'doc',name:'note.txt',kind:'document',mime:'text/plain',text:'Source text.',data:'U291cmNlIHRleHQu'}, {id:'img',name:'pixel.png',kind:'image',mime:'image/png',data:'cGl4ZWw='}])store.put('attachments',a.id,{...a,size:5,sha256:'fixture',at:'2026-10-07T00:00:00Z'});
  const s=initialState();s.assemblyVersion='v2';s.frame={...DEFAULT_FRAME};s.participants=['Boris','Ilya'];s.system='Room rules.';
  for(const c of Object.values(s.characters)){c.prompt='Persona.';c.memory='Remember.';c.model='mock';}
  s.messages=[{id:'message',speaker:'Dennis',speakerRef:{kind:'human'},text:'Hello.',source:'human',attachments:['doc','img']}];return s;
}
export async function captureTranscript(store:Store,name:string) {
  const state=historyState(store),[version,frame]=name.split('-');if(version==='legacy')delete state.assemblyVersion;
  if(frame==='absent')delete state.frame;else if(frame==='custom')state.frame={...DEFAULT_FRAME,identity:'Identity {speaker}',turn:'Speak {speaker}.'};else if(frame==='blank')state.frame={identity:'',context:'',opening:'',turn:''};
  const bodies:string[]=[];const e=new Engine(store,async(_u,o)=>{bodies.push(String(o?.body));return new Response(JSON.stringify({choices:[{message:{content:bodies.length===1?'Ilya: wrong.':'Fine.'}}]}));});
  const b=e.create(name,state);await e.turn(b.id,b.head,'Boris');return bodies;
}
export const perspectiveCases=['cast','empty','own-first','merged','renamed-unbound','shared-persona','attachments','own-document','merged-images'];
export function perspectiveState(store:Store,name:string) {
  const s=historyState(store);s.assembly={history:'perspective'};s.characters={alpha:{...s.characters.Boris,label:'Alice',origin:{item:'persona',revision:'persona-v1'}},beta:{...s.characters.Ilya,label:'Bob',origin:{item:'persona',revision:'persona-v1'}}};s.participants=['alpha','beta'];s.messages=[];
  const add=(speaker:string,text:string,ref:any,attachments?:string[])=>s.messages.push({id:'m'+s.messages.length,speaker,text,speakerRef:ref,source:'edited',...(attachments?{attachments}:{})});
  const own=(text:string,attachments?:string[])=>add('Alice',text,{kind:'person',id:'alpha'},attachments),other=(text:string,attachments?:string[])=>add('Bob',text,{kind:'person',id:'beta'},attachments);
  if(name==='cast'){add('Dennis','Human.',{kind:'human'});own('Mine.');other('Theirs.');add('Narrator','Scene.',{kind:'narrator'});}
  if(name==='own-first')own('Mine.');
  if(name==='merged'){own('One.');own('Two.');other('Three.');add('Narrator','Four.',{kind:'narrator'});}
  if(name==='renamed-unbound'){s.characters.alpha.label='Renamed';own('Old label.');add('Renamed','Unbound.',{kind:'unbound'});}
  if(name==='shared-persona'){other('Same persona, different person.');own('Still mine.');}
  if(name==='attachments'){store.put('attachments','doc2',{...store.get('attachments','doc'),id:'doc2',name:'last.txt',text:'Last source.'});other('Files.',['doc','img','doc2']);}
  if(name==='own-document')own('My document.',['doc']);
  if(name==='merged-images'){other('Files.',['img']);add('Dennis','More files.',{kind:'human'},['doc','img']);}
  return s;
}
