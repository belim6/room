// Metadata only. Run against a development copy; no generation endpoints are used.
const origin=process.env.ROOM_URL||'http://127.0.0.1:4399';
async function api(route:string,body?:unknown) {const r=await fetch(origin+'/api'+route,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const value:any=await r.json();if(!r.ok)throw Error(value.error);return value;}
async function main(){
  const base={branch:'be558803-0a09-4937-813c-19d4b83414cb',revision:'1f7b27db-fd88-4851-8d19-89d69074b226'};
  const record=await api('/branches/'+base.branch),system=record.revisions.find((r:any)=>r.id===base.revision)?.state.system;
  if(typeof system!=='string')throw Error('Exp1 base checkpoint not found');
  const brevity='- Keep replies short, like speech around a table: a few sentences.';
  const oldVote='- When the Moderator asks for your vote, name exactly one living player first (in the form "I vote <name>."), then give your reason briefly.';
  const newVote='- When the Moderator asks for your vote, first state the deduction behind it in one or two sentences, using what is known (revealed roles, who voted for whom), then name exactly one living player in the form "I vote <name>."';
  if(!system.includes(brevity)||!system.includes(oldVote))throw Error('Exp1 source rules do not match the documented experiment');
  const input={name:'Exp1 · Werewolf voting instructions',question:'Does Alexandra’s decisive Day 2 vote follow her own deduction? (Pre-registered in the Werewolf · game 2 notebook, observation 266cbbdb, 2026-09-23T22:49:00Z, before the first trial.)',prediction:'Pre-registered before the first trial (observation 266cbbdb, 2026-09-23T22:49:00Z), verbatim: "If the prompt suppresses reasoning, B and/or C vote Rook/Ceryn/Elorin more often than A; if A is equally off-pile or C still votes Jonas, it is herding/model, not the brevity/format." A correction to that framing was recorded after the results (observation in the same notebook): the pile arithmetic does not make Jonas less likely to be a wolf, so vote on an actual wolf is the more meaningful measure.',retrospective:true,base,speaker:'Alexandra',conditions:[
    {key:'A_control',label:'A · Control',control:true,patch:{system}},
    {key:'B_no_brevity',label:'B · No brevity instruction',patch:{system:system.split('\n').filter((s:string)=>s!==brevity).join('\n')}},
    {key:'C_show_deduction',label:'C · Deduction before vote',patch:{system:system.replace(oldVote,newVote)}}
  ],outcome:{pattern:'I vote\\s+\\**([A-Za-z]+)',flags:'gi',highlight:{Elorin:'wolf',Ceryn:'wolf'}}};
  const existing=(await api('/experiments')).find((e:any)=>e.name===input.name&&e.base.revision===base.revision);
  const exp=existing||await api('/experiments',input);
  const branches=(await api('/bootstrap')).branches.filter((b:any)=>b.parent===base.branch&&!b.comparison&&/^Exp1 · (A_control|B_no_brevity|C_show_deduction) · trial [1-5]$/.test(b.name)).sort((a:any,b:any)=>a.name.localeCompare(b.name));
  if(branches.length!==15)throw Error(`Expected 15 original trials, found ${branches.length}`);
  const detail=await api('/experiments/'+exp.id);
  for(const branch of branches)if(!detail.trials.some((t:any)=>t.branch===branch.id))await api('/experiments/'+exp.id+'/attach',{condition:branch.name.split(' · ')[1],branch:branch.id});
  const result=await api('/experiments/'+exp.id),summary:any={};
  for(const c of result.conditions){const rows=result.trials.filter((t:any)=>t.condition===c.key);summary[c.key]={n:rows.length,outcomes:{},wolf:rows.filter((t:any)=>t.tag==='wolf').length,reasoning:rows.filter((t:any)=>!!t.reasoning).length};for(const t of rows)summary[c.key].outcomes[t.effectiveOutcome]=(summary[c.key].outcomes[t.effectiveOutcome]||0)+1;}
  const expected:any={A_control:{Jonas:5},B_no_brevity:{Jonas:4,Rook:1},C_show_deduction:{Jonas:2,Rook:1,Elorin:1,Ceryn:1}};
  for(const [key,values] of Object.entries(expected))if(summary[key].n!==5||summary[key].reasoning!==5||Object.entries(values as any).some(([k,v])=>summary[key].outcomes[k]!==v))throw Error('Unexpected Exp1 evidence: '+JSON.stringify(summary));
  console.log(JSON.stringify({experiment:exp.id,retrospective:result.experiment.retrospective,summary},null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
