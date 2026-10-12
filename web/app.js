const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let boot, data, current=localStorage.getItem('room-branch'), tab='characters', character=null, selected=null;
let comparison=null, category=localStorage.getItem('room-library')||'conversations', refreshVersion=0;
let showJev=localStorage.getItem('room-show-jev')==='true',jevTimer,jevPollVersion=0;
let branchNavigationPending=false, paneChanges=null;
const records=new Map(), runs=new Map(), drafts=new Map();
async function api(url,body) {const r=await fetch('/api'+url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await r.json();if(!r.ok)throw Error(value.error||'Request failed');return value;}
function error(e){$('#error').textContent=e.message||String(e);$('#error').hidden=false;}
function action(fn){return async(...args)=>{$('#error').hidden=true;try{await fn(...args);}catch(e){error(e);}};}
function dialog(title,html,label='Save'){
  $('#dialog-title').textContent=title;$('#dialog-body').innerHTML=html;$('#dialog-ok').textContent=label;
  return new Promise(resolve=>{const d=$('#dialog');d.onclose=()=>resolve(d.returnValue==='default'?new FormData(d.querySelector('form')):null);d.showModal();});
}
function details(label,obj){return `<details><summary>${esc(label)}</summary><pre>${esc(JSON.stringify(obj,null,2))}</pre></details>`;}
// People are keyed by ID; labels are display text. Legacy characters are keyed by name and have no separate label.
const labelOf=(s,key)=>s.characters[key]?.label??key;
const labelsOf=s=>Object.fromEntries(Object.keys(s.characters).map(k=>[k,labelOf(s,k)]));
const usageText=u=>u?`${u.input} in · ${u.output} out${u.reasoning?` · ${u.reasoning} reasoning`:''}${u.missing?` · ${u.missing} attempt${u.missing===1?'':'s'} without usage`:''}`:'';
function compactRoomName(name){return name.replace(/(?: · (?:compare copy|history retcon|retcon))+$/g,'');}
function rootOf(key){let b=boot.branches.find(b=>b.id===key);const visited=new Set();while(b?.parent&&!visited.has(b.id)){visited.add(b.id);const p=boot.branches.find(p=>p.id===b.parent);if(!p)break;b=p;}return b;}
// Experiment trials stay out of conversation families unless asked for; the open branch always counts.
let showTrials=localStorage.getItem('room-show-trials')==='true';
const inFamily=(b,key)=>showTrials||!b.isTrial||b.id===key;
function familyMembers(key){
  const root=rootOf(key),other=comparison?(comparison.left===key?comparison.right:comparison.left):null;
  if(!root)return [];
  return boot.branches.filter(b=>b.id!==other&&inFamily(b,key)&&rootOf(b.id)?.id===root.id).sort((a,b)=>{
    if(a.id===root.id)return -1;if(b.id===root.id)return 1;
    return a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id);
  });
}
function branchNavHtml(key){
  const members=familyMembers(key),index=members.findIndex(b=>b.id===key),previous=members[index-1],next=members[index+1];
  return `<div class="branch-nav" role="group" aria-label="Branch navigation"><button data-branch-step="-1" data-owner="${key}" aria-label="Previous branch" title="${esc(previous?'Previous: '+previous.name:'First branch')}" ${previous?'':'disabled'}>←</button><button data-family="${key}" title="Choose from the original conversation and its branches">Branches · ${index+1}/${members.length}</button><button data-branch-step="1" data-owner="${key}" aria-label="Next branch" title="${esc(next?'Next: '+next.name:'Last branch')}" ${next?'':'disabled'}>→</button></div>`;
}
// Experiments and saved comparisons: the sidebar lists roots; the header navigator moves through a family.
const families={
  experiment:{items:()=>boot.experiments||[],parent:e=>e.familyParent,current:()=>experimentPage?.experiment.id,open:id=>openExperiment(id),label:'experiments'},
  comparison:{items:()=>boot.comparisons||[],parent:c=>c.parent,current:()=>comparison?.id,open:async id=>openComparison(await api('/comparisons/'+id)),label:'comparisons'},
};
const familyTree=(kind,key)=>RoomFamilies.tree(families[kind].items(),families[kind].parent,key);
const familyRoots=kind=>RoomFamilies.roots(families[kind].items(),families[kind].parent);
function familyNavHtml(kind){
  const key=families[kind].current(),tree=familyTree(kind,key),index=tree.findIndex(t=>t.item.id===key);if(index<0)return '';
  const previous=tree[index-1]?.item,next=tree[index+1]?.item;
  return `<div class="branch-nav" role="group" aria-label="Family navigation"><button data-family-step="-1" data-kind="${kind}" aria-label="Previous in family" title="${esc(previous?'Previous: '+previous.name:'First in family')}" ${previous?'':'disabled'}>←</button><button data-family-pick="${kind}" title="Choose from this family">Family · ${index+1}/${tree.length}</button><button data-family-step="1" data-kind="${kind}" aria-label="Next in family" title="${esc(next?'Next: '+next.name:'Last in family')}" ${next?'':'disabled'}>→</button></div>`;
}
function bindFamilyNav(){
  document.querySelectorAll('[data-family-step]').forEach(b=>b.onclick=action(async()=>{const kind=b.dataset.kind,key=families[kind].current(),tree=familyTree(kind,key),target=tree[tree.findIndex(t=>t.item.id===key)+Number(b.dataset.familyStep)];if(target)await families[kind].open(target.item.id);}));
  document.querySelectorAll('[data-family-pick]').forEach(b=>b.onclick=action(async()=>{
    const kind=b.dataset.familyPick,key=families[kind].current(),tree=familyTree(kind,key);
    const f=await dialog('Family of '+tree[0].item.name,`<label>Open<select name="member">${tree.map(t=>`<option value="${t.item.id}" ${t.item.id===key?'selected':''}>${'\u00a0\u00a0\u00a0'.repeat(t.depth)}${t.depth?'↳ ':''}${esc(t.item.name)}</option>`).join('')}</select></label>`,'Open');
    if(f&&f.get('member')!==key)await families[kind].open(f.get('member'));
  }));
}
async function stepBranch(key,direction){
  if(branchNavigationPending)return;
  const members=familyMembers(key),index=members.findIndex(b=>b.id===key),target=members[index+direction];
  if(index<0||!target)return;
  branchNavigationPending=true;
  try{if(comparison)await replacePane(key,target);else await choose(target.id);}
  finally{branchNavigationPending=false;}
}
function isBusy(key){return runs.has(key)||boot?.active.includes(key)||!!records.get(key)?.run;}
function rememberInputs(){
  document.querySelectorAll('[data-controls]').forEach(el=>{
    if(el.closest('[hidden]'))return;
    const old=drafts.get(el.dataset.controls)||{};
    drafts.set(el.dataset.controls,{...old,text:el.querySelector('[data-text]')?.value||'',speaker:el.querySelector('[data-speaker]')?.value||'',count:el.querySelector('[data-count]')?.value||'1',place:el.querySelector('[data-place]')?.value??old.place,alternate:el.querySelector('[data-alternate]')?.checked??old.alternate});
  });
}
async function refresh(){
  rememberInputs();const version=++refreshVersion;
  const next=await api('/bootstrap');
  if(comparison && ![comparison.left,comparison.right].every(key=>next.branches.some(b=>b.id===key))){comparison=null;localStorage.removeItem('room-comparison');}
  if(!comparison&&next.branches.find(b=>b.id===current)?.comparison)current=null;
  if(!next.branches.some(b=>b.id===current)){current=next.branches.find(b=>!b.parent&&!b.comparison)?.id;selected=null;}
  const ids=comparison?[comparison.left,comparison.right]:current?[current]:[];
  const values=await Promise.all(ids.map(id=>api('/branches/'+id+(tab==='inspect'?'':'?view=conversation'))));
  if(version!==refreshVersion)return;
  boot=next;values.forEach(v=>records.set(v.branch.id,v));
  await Promise.all(ids.map(k=>refreshSeen(k).catch(()=>{})));if(version!==refreshVersion)return;
  data=records.get(current)||null;
  if(current)localStorage.setItem('room-branch',current);else localStorage.removeItem('room-branch');
  render();
}
// Views go into browser history so Back (button, mouse, gesture) returns to the previous one.
let restoringView=false;
function viewOf(){return experimentPage?{kind:'experiment',id:experimentPage.experiment.id}:comparison?(comparison.id&&!comparison.draft?{kind:'comparison',id:comparison.id}:null):current?{kind:'branch',id:current}:null;}
function trackView(){
  const v=viewOf(),s=history.state;
  if(v&&!restoringView&&!(s?.kind===v.kind&&s?.id===v.id)){if(s)history.pushState({...v,depth:(s.depth||0)+1},'');else history.replaceState({...v,depth:0},'');}
  $('#back').disabled=!history.state?.depth;
}
addEventListener('popstate',ev=>{const v=ev.state;if(!v)return;restoringView=true;action(async()=>{try{if(v.kind==='experiment')await openExperiment(v.id);else if(v.kind==='comparison')await openComparison(await api('/comparisons/'+v.id));else await choose(v.id);}finally{restoringView=false;$('#back').disabled=!history.state?.depth;}})();});
async function choose(id){leaveExperiment();leaveVault();paneChanges=null;rememberInputs();comparison=null;localStorage.removeItem('room-comparison');current=id;selected=null;category='conversations';await refresh();}
async function openComparison(value){
  leaveExperiment();leaveVault();paneChanges=null;
  rememberInputs();comparison=value;current=value.left;selected=null;category='comparisons';
  if(value.id)localStorage.setItem('room-comparison',value.id);else localStorage.removeItem('room-comparison');
  await refresh();
}
function focusPane(key,nextTab=tab,message=null){current=key;data=records.get(key);selected=message;tab=nextTab;renderPanel();document.querySelectorAll('[data-pane]').forEach(p=>p.classList.toggle('focused',p.dataset.pane===key));}
async function replacePane(oldId,next){
  if(comparison){if(comparison.left===oldId)comparison.left=next.id;else if(comparison.right===oldId)comparison.right=next.id;comparison.dirty=true;current=next.id;selected=null;await refresh();}
  else await choose(next.id);
}
// Marked replies are fetched on demand and cached until a mark changes or the tab is reopened.
const marked={stale:true,value:null,items:[]};
function markedLibrary(value){
  const paint=()=>{
    const live=new Set(boot.branches.map(b=>b.id)),label=value==='favorite'?'favorites':'dislikes';
    $('#branches').innerHTML=`<a class="file-button" href="/api/reactions/${value}/export" download>Export ${label} (JSON)</a>`+(marked.items.map(m=>`<button data-marked="${m.message}" data-marked-branch="${m.branch}" ${live.has(m.branch)?'':'disabled'}><strong>${esc(m.speaker||'Unknown')}</strong> ${esc((m.text||'Message text not found').slice(0,110))}${(m.text||'').length>110?'…':''}<small>${esc(m.branchName||'Unknown branch')}${live.has(m.branch)?'':' · in Trash'} · ${esc(new Date(m.at).toLocaleString())}</small></button>`).join('')||`<p class="muted">No ${label} yet. Use ${value==='favorite'?'☆ Favorite':'Dislike'} under a reply.</p>`);
    document.querySelectorAll('[data-marked]').forEach(b=>b.onclick=action(async()=>{const key=b.dataset.marked;await choose(b.dataset.markedBranch);category=value==='favorite'?'favorites':'dislikes';renderLibrary();focusPane(current,'inspect',key);document.querySelector(`[data-inspect="${key}"]`)?.closest('.message')?.scrollIntoView({block:'center'});}));
  };
  if(!marked.stale&&marked.value===value)return paint();
  marked.stale=false;marked.value=value;
  api('/reactions/'+value).then(items=>{marked.items=items;if(category===(value==='favorite'?'favorites':'dislikes'))paint();}).catch(error);
}
function renderLibrary(){
  for(const name of ['conversations','comparisons','experiments','vault','trash','favorites','dislikes'])$('#show-'+name).classList.toggle('selected',category===name);
  $('#library-label').textContent=category==='favorites'?'FAVORITE REPLIES':category==='dislikes'?'DISLIKED REPLIES':category==='conversations'?'CONVERSATIONS':category==='trash'?'TRASH':category==='experiments'?'EXPERIMENTS':category==='vault'?'VAULT':'SAVED COMPARISONS';localStorage.setItem('room-library',category);
  $('#new-experiment').hidden=category!=='experiments';
  if(category==='vault'){vaultLibrary();}
  else if(category==='experiments'){experimentLibrary();}
  else if(category==='favorites'||category==='dislikes'){markedLibrary(category==='favorites'?'favorite':'dislike');}
  else if(category==='conversations'){
    const root=rootOf(current);
    $('#branches').innerHTML=boot.branches.filter(b=>!b.parent&&!b.comparison&&!b.workspace).map(b=>`<button data-branch="${b.id}" class="${!comparison&&root?.id===b.id?'active':''}">${esc(b.name)}<small>${boot.branches.filter(x=>x.id!==b.id&&inFamily(x,null)&&rootOf(x.id)?.id===b.id).length} branches</small></button>`).join('')||'<p class="muted">No conversations yet.</p>';
    document.querySelectorAll('[data-branch]').forEach(b=>b.onclick=action(()=>choose(b.dataset.branch)));
  }else if(category==='trash'){
    $('#branches').innerHTML=(boot.trash||[]).map(t=>`<div class="trash-item"><strong>${esc(t.name)}</strong><small>${t.branches.length-1} included branches · ${esc(new Date(t.deletedAt).toLocaleDateString())}</small><button data-restore="${t.id}" ${t.canRestore?'':'disabled'}>Restore</button>${t.canRestore?'':'<small>Restore its parent conversation first.</small>'}</div>`).join('')||'<p class="muted">Trash is empty.</p>';
    document.querySelectorAll('[data-restore]').forEach(b=>b.onclick=action(async()=>{const restored=await api('/trash/'+b.dataset.restore+'/restore',{});await choose(restored.id);}));
  }else{
    const open=comparison?.id?familyTree('comparison',comparison.id)[0]?.item.id:null;
    $('#branches').innerHTML=familyRoots('comparison').map(c=>{const n=familyTree('comparison',c.id).length-1;return `<button data-comparison="${c.id}" class="${open===c.id?'active':''}">${esc(c.name)}<small>Saved comparison${n?` · ${n} branch${n===1?'':'es'}`:''}</small></button>`;}).join('')||'<p class="muted">Open two conversations with Compare, then save the comparison.</p>';
    document.querySelectorAll('[data-comparison]').forEach(b=>b.onclick=action(async()=>openComparison(await api('/comparisons/'+b.dataset.comparison))));
  }
}
function paintJev(){
  $('#show-jev').checked=showJev;$('#refresh-jev').hidden=!showJev;$('#jev-help').hidden=!showJev;
  document.querySelectorAll('[data-jev-message]').forEach(el=>{
    el.hidden=!showJev;if(!showJev){el.innerHTML='';return;}
    const record=records.get(el.dataset.owner),message=record?.branch.revision.state.messages.find(m=>m.id===el.dataset.jevMessage);
    el.innerHTML=message?RoomJev.render(message,record.jev,record.selections,labelsOf(record.branch.revision.state)):'';
  });
}
function scheduleJevPoll(){
  clearTimeout(jevTimer);const version=++jevPollVersion;
  if(showJev)jevTimer=setTimeout(()=>refreshJevObservations(version,0,false),1200);
}
async function refreshJevObservations(version,round,manual){
  if(!showJev||version!==jevPollVersion)return;
  const visible=comparison?[comparison.left,comparison.right]:current?[current]:[];
  const keys=visible.filter(key=>manual||records.get(key)?.jev.some(j=>!j.outcome&&records.get(key).branch.revision.state.messages.some(m=>m.turnId===j.turnId)));
  if(!keys.length)return;
  // Read saved evidence only. Never trigger another Jev/model request.
  const results=await Promise.allSettled(keys.map(async key=>({key,value:await api('/branches/'+key)})));
  if(!showJev||version!==jevPollVersion)return;
  for(const result of results)if(result.status==='fulfilled'&&records.has(result.value.key))records.get(result.value.key).jev=result.value.value.jev;
  paintJev();
  const failed=results.some(r=>r.status==='rejected');
  $('#jev-refresh-status').textContent=failed?'Could not refresh. Try Refresh observations.':'';
  if(!failed&&round<5)jevTimer=setTimeout(()=>refreshJevObservations(version,round+1,false),1200);
}
// The label a line was written under stays as evidence; a later rename is shown beside it, never instead of it.
function speakerNote(state,key,m){const r=records.get(key)?.identity?.[m.id];if(r?.kind==='person'&&labelOf(state,r.id)!==m.speaker)return `<span class="muted" title="This person has been renamed since">now ${esc(labelOf(state,r.id))}</span>`;if(r?.kind==='unbound')return '<span class="badge" title="Not attributed to anyone in this room">unbound</span>';if(r?.kind==='narrator')return '<span class="badge">narrator</span>';return '';}
function messagesHtml(state,key){const shown=state.messages.filter(viewKeep(state,key)),hidden=state.messages.length-shown.length;return (hidden?`<p class="muted view-note">${hidden} message${hidden===1?'':'s'} not shown in this view.</p>`:'')+(shown.map(m=>`<article class="message ${m.source==='human'?'human':''}"><div class="avatar">${esc([...m.speaker][0])}</div><div><div class="message-head"><strong>${esc(m.speaker)}</strong>${speakerNote(state,key,m)}<span class="badge">${esc(m.source)}</span>${locationTag(m)}</div><p>${esc(m.text)}</p><div class="message-attachments">${messageAttachments(m,key)}</div><div class="message-actions"><button data-inspect="${m.id}" data-owner="${key}">Inspect</button><button data-fork="${m.id}" data-owner="${key}">Branch here</button><button data-retcon="${m.id}" data-owner="${key}">Retcon</button><button data-note="${m.id}" data-owner="${key}">Observe</button>${m.source==='generated'||m.review?`<button data-revise="${m.id}" data-owner="${key}">Revise</button>`:''}${m.source==='human'?'':reactionButtons(m.id,key)}${state.locations?`<button data-audience="${m.id}" data-owner="${key}">Who heard this</button>`:''}<button data-delete-message="${m.id}" data-owner="${key}">Delete message</button></div><div data-jev-message="${m.id}" data-owner="${key}" hidden></div></div></article>`).join('')||(hidden?'':'<div class="empty"><h2>What should we get into?</h2><p>Add a thought, or let a character begin.</p></div>'));}
function reactionButtons(message,key){const r=boot.reactions?.[message];return `<button data-react="favorite" data-message="${message}" data-owner="${key}" class="${r==='favorite'?'reacted':''}" aria-pressed="${r==='favorite'}">${r==='favorite'?'★ Favorite':'☆ Favorite'}</button><button data-react="dislike" data-message="${message}" data-owner="${key}" class="${r==='dislike'?'reacted':''}" aria-pressed="${r==='dislike'}">${r==='dislike'?'✕ Disliked':'Dislike'}</button>`;}
function controlsHtml(key){
  const rec=records.get(key),s=rec.branch.revision.state,d=drafts.get(key)||{},generating=isBusy(key),busy=generating||attachmentBusy(key),run=runs.get(key),remote=!run&&rec.run,empty=!s.participants.length;
  // The run line reflects the server's run record (checked against the branch), not a guess from local state.
  const status=run?(run.stopping?'Stopping…':`Run · turn ${run.index} of ${run.count}${run.usage?' · '+usageText(run.usage):''}`):remote?`A run is active (turn ${remote.turns.length} of ${remote.maxTurns}${remote.usage?' · '+usageText(remote.usage):''})`:generating?'Generating…':'';
  // With places, Continue happens in one chosen place (or rotates); only the active characters there can be picked.
  const place=s.locations?chosenPlace(key):null,voices=!s.locations?s.participants:place==='rotate'?[]:localCastOf(s,place),pair=s.locations?place==='rotate'||voices.length===2:s.participants.length===2;
  return `${empty?'<p class="notice">Nobody is in this room yet. Use <button type="button" class="link-button" data-add-person-now="'+key+'">Add person</button> in Characters to begin.</p>':''}${viewHtml(key)}<div class="turn-controls">${s.locations?placeControlsHtml(key):''}<label>Next voice <select data-speaker><option value="">${place==='rotate'?'Random in each place':'Random participant'}</option>${voices.map(p=>`<option value="${esc(p)}" ${p===d.speaker?'selected':''}>${esc(labelOf(s,p))}</option>`).join('')}</select></label><label>Turns <input data-count type="number" value="${esc(d.count||1)}" min="1" max="20"></label>${pair?`<label title="Each turn goes to whichever of the two didn't speak last"><input data-alternate type="checkbox" ${(d.alternate??s.flow==='alternate')?'checked':''} style="width:auto"> Back-and-forth</label>`:''}<button data-generate="${key}" class="primary" ${busy||empty?'disabled':''}>Continue ↗</button><button data-stop="${key}" ${generating?'':'hidden'}>Stop</button>${s.locations?placeActionsHtml(key):''}<span class="muted" role="status">${esc(status)}</span></div>${speakingInHtml(key)}${attachmentComposer(key)}<form data-compose="${key}"><textarea data-text aria-label="Your message" rows="2" placeholder="Say something to this conversation…" ${messageSends.has(key)?'disabled':''}>${esc(d.text||'')}</textarea><button class="primary" type="submit" ${attachmentBusy(key)?'disabled':''} title="You can speak during a run; the run continues after your message">Send</button></form>`;
}
function changesBadge(key){const c=records.get(key)?.changes;if(!c?.fork)return '';const all=RoomChanges.badges(c.changes);return `<button class="changes-badge" data-changes="${key}" title="View changes since fork">${esc(all.slice(0,3).join(' · ')||'No changes since fork')}${all.length>3?' · +'+(all.length-3)+' more':''}</button>`;}
// Re-rendering replaces the view's DOM; keep focus, caret, scroll (following the bottom) and open details so background refreshes stay unobtrusive.
function focusSelector(el){
  if(el.id)return '#'+CSS.escape(el.id);
  const owner=el.closest('[data-controls]'),attr=['data-text','data-speaker','data-count','data-place','data-alternate'].find(a=>el.hasAttribute(a));
  return owner&&attr?`[data-controls="${CSS.escape(owner.dataset.controls)}"] [${attr}]`:null;
}
function capturePlace(){
  const a=document.activeElement,view=JSON.stringify(viewOf()),panel=$('#panel').dataset.key+':'+selected;
  const focus=a&&a!==document.body&&a.matches('input,textarea,select')&&!a.closest('dialog')?{sel:focusSelector(a),start:a.selectionStart,end:a.selectionEnd,top:a.scrollTop}:null;
  const scroll=['#messages','.inspector',...[...document.querySelectorAll('[data-pane]')].map(p=>`[data-pane="${CSS.escape(p.dataset.pane)}"] .pane-messages`)].map(sel=>{const el=document.querySelector(sel);return el&&{sel,top:el.scrollTop,bottom:sel!=='.inspector'&&el.scrollHeight-el.scrollTop-el.clientHeight<40};}).filter(Boolean);
  const details=new Map([...document.querySelectorAll('#panel details > summary')].map(s=>[s.textContent,s.parentElement.open]));
  return {view,panel,focus,scroll,details};
}
function restorePlace(p){
  if(p.view!==JSON.stringify(viewOf()))return;
  for(const s of p.scroll){const el=document.querySelector(s.sel);if(el)el.scrollTop=s.bottom?el.scrollHeight:s.top;}
  if(p.panel===$('#panel').dataset.key+':'+selected)for(const s of document.querySelectorAll('#panel details > summary'))if(p.details.has(s.textContent))s.parentElement.open=p.details.get(s.textContent);
  const a=document.activeElement;
  if(p.focus?.sel&&(!a||a===document.body)){const el=document.querySelector(p.focus.sel);if(el&&!el.disabled){el.focus({preventScroll:true});try{if(p.focus.start!=null)el.setSelectionRange(p.focus.start,p.focus.end);}catch{}el.scrollTop=p.focus.top;}}
}
function render(){const place=capturePlace();try{renderView();}finally{restorePlace(place);}}
function renderView(){
  clearTimeout(jevTimer);++jevPollVersion;
  rememberInputs();renderLibrary();$('#connection').textContent=`OpenGateway ${boot.keys.opengateway?'● ready':'○ no key'} · Together ${boot.keys.together?'● ready':'○ no key'}`;
  trackView();
  if(vaultPage){$('#family-nav').hidden=true;renderVault();return;}
  $('#vault-page').hidden=true;
  if(experimentPage){$('#title-changes').hidden=true;$('#family-nav').hidden=false;$('#family-nav').innerHTML=familyNavHtml('experiment');bindFamilyNav();renderExperiment();return;}
  document.querySelector('.workspace').classList.remove('experiment-mode');$('#experiment-page').hidden=true;
  $('#diff-panes').hidden=!comparison;
  document.querySelector('.workspace').classList.toggle('comparing',!!comparison);
  $('#messages').hidden=!!comparison;$('#comparison').hidden=!comparison;document.querySelector('main > footer').hidden=!!comparison||!data;
  for(const key of ['fork','history','compare','export','delete'])$('#'+key).disabled=!data;
  for(const key of ['fork','history','export','delete'])$('#'+key).hidden=!!comparison;
  $('#title-changes').hidden=!!comparison||!data;$('#family-nav').hidden=comparison?!(comparison.id&&!comparison.draft):!data;
  $('#save-comparison').hidden=!comparison;$('#fork-comparison').hidden=!comparison?.id||!!comparison?.draft;
  $('#fork-comparison').disabled=!!comparison?.dirty;
  $('#save-comparison').textContent=comparison?.dirty?'Save comparison *':'Save comparison';
  $('#compare').textContent=comparison?'Close comparison':'Compare';
  if(!data){
    $('#title').textContent='A space to think together.';$('#subtitle').textContent='Create a room or restore a conversation from Trash.';
    $('#messages').innerHTML='<div class="empty"><h2>Your room is ready.</h2><p>Create a conversation to begin.</p></div>';$('#comparison').innerHTML='';
    const footer=document.querySelector('main > footer');footer.innerHTML='';delete footer.dataset.controls;
    $('#panel-context').textContent='';$('#panel').dataset.key='';$('#panel').innerHTML='<h2>Your workshop</h2><p>Create a room to begin.</p>';return;
  }
  $('#delete').textContent=data.branch.parent?'Delete branch':'Delete conversation';
  if(comparison){
    $('#family-nav').innerHTML=familyNavHtml('comparison');bindFamilyNav();
    $('#title').textContent=comparison.name||'Compare conversations';$('#subtitle').textContent='Independent conversation copies · changes stay in this comparison';
    const positions=new Map([...document.querySelectorAll('[data-pane]')].map(p=>[p.dataset.pane,p.querySelector('.pane-messages').scrollTop]));
    $('#comparison').innerHTML=[comparison.left,comparison.right].map((key,index)=>{
      const b=records.get(key).branch;
      return `<section class="comparison-pane ${key===current?'focused':''}" data-pane="${key}" aria-label="${index?'Right':'Left'} conversation"><div class="pane-header"><div class="eyebrow">${index?'RIGHT':'LEFT'} CONVERSATION</div><h2>${esc(compactRoomName(b.name))}</h2><div class="pane-actions"><button data-settings="${key}">Characters & settings</button><button data-pane-fork="${key}">Branch</button><button data-history="${key}">Edit history</button>${branchNavHtml(key)}${changesBadge(key)}</div></div><div class="pane-messages">${messagesHtml(b.revision.state,key)}</div><div class="pane-footer" data-controls="${key}">${controlsHtml(key)}</div></section>`;
    }).join('');
    document.querySelectorAll('[data-pane]').forEach(p=>{if(positions.has(p.dataset.pane))p.querySelector('.pane-messages').scrollTop=positions.get(p.dataset.pane);});
  }else{
    const b=data.branch,s=b.revision.state,root=rootOf(b.id);
    $('#title').textContent=compactRoomName(b.name);$('#subtitle').textContent=`${s.participants.length} participants · ${s.messages.length} messages${b.parent?' · Branch of '+root.name:''}`;
    $('#family-nav').innerHTML=branchNavHtml(current);$('#title-changes').innerHTML=changesBadge(current);
    $('#messages').innerHTML=messagesHtml(s,current);
    const footer=document.querySelector('main > footer');footer.dataset.controls=current;footer.innerHTML=controlsHtml(current)+'<div class="footnote">Sending adds your message. Continue gives a character the floor.</div>';
  }
  bindControls();renderPanel(false);paintJev();scheduleJevPoll();scheduleRunPoll();
}
function bindControls(){
  document.querySelectorAll('[data-changes]').forEach(b=>b.onclick=()=>{paneChanges=null;focusPane(b.dataset.changes,'changes');});
  document.querySelectorAll('[data-inspect]').forEach(b=>b.onclick=()=>focusPane(b.dataset.owner,'inspect',b.dataset.inspect));
  document.querySelectorAll('[data-react]').forEach(b=>b.onclick=action(async()=>{const on=boot.reactions?.[b.dataset.message]===b.dataset.react;boot.reactions=await api('/reactions',{branch:b.dataset.owner,message:b.dataset.message,value:on?null:b.dataset.react});marked.stale=true;const scroll=[...document.querySelectorAll('.messages,.pane-messages')].map(el=>el.scrollTop);render();document.querySelectorAll('.messages,.pane-messages').forEach((el,i)=>el.scrollTop=scroll[i]??el.scrollTop);}));
  document.querySelectorAll('[data-note]').forEach(b=>b.onclick=()=>focusPane(b.dataset.owner,'notes',b.dataset.note));
  document.querySelectorAll('[data-fork]').forEach(b=>b.onclick=action(()=>forkAt(b.dataset.owner,b.dataset.fork)));
  document.querySelectorAll('[data-revise]').forEach(b=>b.onclick=action(()=>openReview(b.dataset.owner,b.dataset.revise)));
  document.querySelectorAll('[data-delete-message]').forEach(b=>b.onclick=action(()=>deleteMessage(b.dataset.owner,b.dataset.deleteMessage)));
  document.querySelectorAll('[data-retcon]').forEach(b=>b.onclick=action(()=>retcon(b.dataset.owner,b.dataset.retcon)));
  document.querySelectorAll('[data-settings]').forEach(b=>b.onclick=()=>focusPane(b.dataset.settings,'characters'));
  document.querySelectorAll('[data-pane-fork]').forEach(b=>b.onclick=action(()=>forkAt(b.dataset.paneFork)));
  document.querySelectorAll('[data-history]').forEach(b=>b.onclick=action(()=>editHistory(b.dataset.history)));
  document.querySelectorAll('[data-branch-step]').forEach(b=>b.onclick=action(()=>stepBranch(b.dataset.owner,Number(b.dataset.branchStep))));
  document.querySelectorAll('[data-family]').forEach(b=>b.onclick=action(()=>showFamily(b.dataset.family)));
  document.querySelectorAll('[data-generate]').forEach(b=>b.onclick=action(()=>runTurns(b.dataset.generate)));
  // Stop ends the run for good, including between turns; a run started in another tab is stopped through its record.
  document.querySelectorAll('[data-stop]').forEach(b=>b.onclick=action(async()=>{const key=b.dataset.stop,run=runs.get(key),target=run?.id||records.get(key)?.run?.id;if(run)run.stopping=true;if(target)await api('/runs/'+target+'/stop',{});else await api('/branches/'+key+'/stop',{});await refresh();}));
  document.querySelectorAll('[data-add-person-now]').forEach(b=>b.onclick=action(()=>{focusPane(b.dataset.addPersonNow,'characters');return addPerson(b.dataset.addPersonNow);}));
  document.querySelectorAll('[data-compose]').forEach(f=>f.onsubmit=action(async e=>{e.preventDefault();await sendRoomMessage(f);}));
  bindAttachmentControls();bindPlaceControls();
  document.querySelectorAll('[data-text]').forEach(t=>t.onkeydown=e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey))t.closest('form').requestSubmit();});
}
// Runs advanced by another tab are polled until they end; focus and reconnect refresh at once.
let runPollTimer=null;
// A failed refresh reschedules itself with backoff; a successful one re-renders, which reschedules from zero.
function scheduleRunPoll(failures=0){
  clearTimeout(runPollTimer);if(live.connected)return;const visible=(comparison?[comparison.left,comparison.right]:current?[current]:[]).map(k=>records.get(k));
  if(RoomRuns.shouldPoll(visible,k=>runs.has(k)))runPollTimer=setTimeout(()=>{refresh().catch(()=>scheduleRunPoll(failures+1));},RoomRuns.pollDelay(failures));
}
addEventListener('focus',()=>{if(boot)refresh().catch(()=>{});});
// Live notices carry IDs only; a notice touching what is on screen triggers the usual refresh, debounced.
// While disconnected, the run and experiment polls above take over; reconnects back off up to 30 s.
const live={source:null,connected:false,ever:false,failures:0,retry:null,debounce:null,first:0,flushing:false,failed:0,pending:new Set()};
function liveStatus(text){const el=$('#live');el.textContent=text;el.classList.toggle('on',live.connected);}
function connectLive(){
  if(typeof EventSource==='undefined')return liveStatus('Live updates unavailable · refresh to update');
  if(document.hidden)return pauseLive();if(live.source)return;
  const source=live.source=new EventSource('/api/events');
  source.onopen=()=>{live.connected=true;live.ever=true;live.failures=0;liveStatus('Live');clearTimeout(runPollTimer);clearTimeout(experimentTimer);if(boot)queueLive({kind:'resync'});};
  source.onmessage=ev=>{try{queueLive(JSON.parse(ev.data));}catch{}};
  source.onerror=()=>{
    source.close();if(live.source!==source)return;live.source=null;
    const was=live.connected;live.connected=false;liveStatus(live.ever?'Reconnecting…':'Connecting…');
    if(was&&boot&&!vaultPage){scheduleRunPoll();if(experimentPage?.active){clearTimeout(experimentTimer);const key=experimentPage.experiment.id;experimentTimer=setTimeout(()=>reloadExperiment(key).catch(()=>{}),1200);}}
    clearTimeout(live.retry);live.retry=setTimeout(connectLive,Math.min(30000,1000*2**live.failures++));
  };
}
const LIBRARY_KINDS=['branches','comparisons','experiments','experiment-revisions','experiment-locks','experiment-links'];
function liveTarget(n){
  if(vaultPage)return null;
  if(n.kind==='resync'||n.kind==='trash')return 'view';
  if(experimentPage){if(n.experiment===experimentPage.experiment.id||(n.branch&&experimentPage.trials.some(t=>t.branch===n.branch)))return 'experiment';}
  else if(n.branch&&(comparison?[comparison.left,comparison.right]:[current]).includes(n.branch))return 'view';
  if(n.kind==='reactions'){marked.stale=true;return category==='favorites'||category==='dislikes'?'library':null;}
  return LIBRARY_KINDS.includes(n.kind)?'library':null;
}
// Debounced 300 ms, but a steady stream of notices still renders at least every 1.2 s.
function scheduleFlush(){live.first||=Date.now();clearTimeout(live.debounce);live.debounce=setTimeout(flushLive,Math.max(0,Math.min(300,live.first+1200-Date.now())));}
function queueLive(n){const t=liveTarget(n);if(!t)return;live.pending.add(t);scheduleFlush();}
// One flush at a time, so an older snapshot never renders over a newer one; notices that arrive meanwhile flush afterwards.
async function flushLive(){
  if(live.flushing)return;
  // An open dialog was filled from the current state; refresh once it closes.
  if($('#dialog').open){$('#dialog').addEventListener('close',()=>{live.first=0;scheduleFlush();},{once:true});return;}
  live.first=0;const p=live.pending;live.pending=new Set();if(!p.size||!boot||vaultPage)return;
  live.flushing=true;
  try{
    if(experimentPage&&(p.has('experiment')||p.has('view')))await reloadExperiment(experimentPage.experiment.id);
    else if(!experimentPage&&p.has('view'))await refresh();
    else{const next=await api('/bootstrap');if(!live.pending.size){boot=next;renderLibrary();}}
    live.failed=0;
  }catch{
    // A failed fetch stays owed: resync whatever view is open then, backing off 1 s, 2 s, … up to 15 s until one succeeds.
    live.pending.add('view');live.failed=(live.failed||0)+1;
  }
  finally{
    live.flushing=false;
    if(live.failed&&live.pending.has('view')){clearTimeout(live.debounce);live.debounce=setTimeout(flushLive,Math.min(15000,1000*2**(live.failed-1)));}
    else if(live.pending.size)scheduleFlush();
  }
}
// Hidden tabs hold no connection (browsers allow about six per host); showing the tab reconnects and resyncs.
function pauseLive(){clearTimeout(live.retry);live.source?.close();live.source=null;live.connected=false;liveStatus('Paused while hidden');}
document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseLive();else{live.failures=0;connectLive();}});
connectLive();addEventListener('online',()=>{if(boot)refresh().catch(()=>{});});
function scrollMessages(key){const pane=document.querySelector(`[data-pane="${key}"] .pane-messages`);const el=pane||(!comparison&&key===current?$('#messages'):null);if(el)el.scrollTop=el.scrollHeight;}
async function runTurns(key){
  if(isBusy(key)||attachmentBusy(key))return;rememberInputs();const rec=records.get(key),s=rec.branch.revision.state,d=drafts.get(key)||{},count=Number(d.count||1),place=s.locations?chosenPlace(key):undefined,voices=!s.locations?s.participants:place==='rotate'?[]:localCastOf(s,place),speaker=voices.includes(d.speaker)?d.speaker:'',alternate=!!(d.alternate??s.flow==='alternate')&&(s.locations?place==='rotate'||voices.length===2:s.participants.length===2);
  if(!Number.isInteger(count)||count<1||count>20)throw Error('Choose 1–20 turns');
  // Every Continue is a run record, persisted before its first turn; the server accepts only the next index.
  const policy=alternate?{kind:'alternate',...(speaker?{speaker}:{})}:speaker?{kind:'fixed',speaker}:{kind:'random'};
  const record=await api('/branches/'+key+'/runs',{expected:rec.branch.head,maxTurns:count,policy,...(place?{place}:{})});
  const run={id:record.id,count,index:1,stopping:false,usage:record.usage};runs.set(key,run);render();
  // The server decides when the run is done: a turn detached by your interjection doesn't count toward the limit.
  try{await RoomRuns.drive(n=>api('/runs/'+run.id+'/turns',{index:n}),async out=>{run.usage=out.run.usage;run.index=out.run.turns.length-(out.run.uncounted?.length||0)+1;await refresh();scrollMessages(key);},()=>run.stopping);}
  finally{runs.delete(key);await refresh();}
}
function renderPanel(force = true) {
  document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('selected',b.dataset.tab===tab));
  if(!data)return;
  const s=data.branch.revision.state, panel=$('#panel');
  $('#panel-context').textContent=(comparison ? (current===comparison.left?'Left':'Right')+' pane · ' : '')+data.branch.name;
  const panelKey=current+':'+tab+':'+character+(s.locations?':'+JSON.stringify(s.locations):'');
  if(!force && (tab==='characters'||tab==='revise') && panel.dataset.key===panelKey)return;
  const noteDraft=tab==='notes' && panel.dataset.key===panelKey ? $('#observation')?.value : '';
  panel.dataset.key=panelKey;
  if(tab==='characters') {
    const ids=Object.keys(s.characters),people=data.people||{},v2=data.assemblyVersion==='v2';
    if(!s.characters[character]){character=s.participants[0]||ids[0]||null;panel.dataset.key=current+':'+tab+':'+character+(s.locations?':'+JSON.stringify(s.locations):'');}
    const c=character?s.characters[character]:null,former=formerLabels(data),template=Object.entries(data.template||{});
    const flagged=k=>{const sit=(s.characters[k].situation||'').toLocaleLowerCase();return [...former].filter(l=>sit.includes(l.toLocaleLowerCase()));};
    const row=k=>{const st=people[k]||{},f=flagged(k);return `<div class="person-row ${k===character?'selected':''}"><div><button type="button" class="link-button" data-person-select="${esc(k)}">${esc(labelOf(s,k))}</button> ${st.active?'':'<span class="badge">inactive</span>'}${s.locations?`<span class="badge">${esc(placeNameOf(s,s.locations.at[k]))}</span>`:''}${st.originTitle?`<span class="badge" title="Persona revision ${esc(st.origin.revision)}">from ${esc(st.originTitle)}</span>`:''}${st.diverged?'<span class="badge badge-warn" title="Prompt edited here; it no longer matches its persona revision">diverged</span>':''}${st.updateAvailable?'<span class="badge badge-update">update available</span>':''}${f.length?`<span class="badge badge-warn" title="Its situation mentions a former label (${esc(f.join(', '))}). It was not rewritten.">review situation</span>`:''}</div><div class="person-actions"><button type="button" data-person-rename="${esc(k)}">Rename</button>${st.origin?`<button type="button" data-person-adopt="${esc(k)}">Adopt…</button>`:''}<button type="button" data-person-active="${esc(k)}" data-active="${st.active?'false':'true'}">${st.active?'Deactivate':'Activate'}</button><button type="button" data-person-preview="${esc(k)}">Assembled</button></div></div>`;};
    const providers=['opengateway','together',...(boot.keys.demo?['demo']:[])].map(p=>`<option value="${p}" ${p===c?.provider?'selected':''}>${p==='demo'?'Local demo (no API calls)':p==='together'?'Together':'OpenGateway'}</option>`).join('');
    const person=c?`<div class="divider"></div><h2>${esc(labelOf(s,character))}</h2><label for="prompt">Personality instructions${people[character]?.diverged?' · edited here':''}</label><textarea id="prompt" rows="9">${esc(c.prompt)}</textarea><label for="situation">Situation in this room · role, wants, relationships</label><textarea id="situation" rows="3" placeholder="Only for this room; never part of the persona.">${esc(c.situation||'')}</textarea><label for="memory">Retained memory · edited by you</label><textarea id="memory" rows="3">${esc(c.memory)}</textarea><label for="provider">Provider</label><select id="provider">${providers}</select>${c.provider==='demo'&&!boot.keys.demo?'<p class="notice">This character uses local demo, which only runs on instances started with ROOM_DEMO=1. Choose a provider and model, then save (or apply to all characters) before generating.</p>':''}<label for="model">Model ID</label><input id="model" value="${esc(c.provider==='demo'&&!boot.keys.demo?'deepseek/deepseek-flash':c.model)}" placeholder="Exact provider model identifier"><label for="temperature">Temperature</label><input id="temperature" type="number" min="0" max="2" step="0.1" value="${c.temperature}"><label for="reasoning">Reasoning</label><select id="reasoning"><option value="default">Provider default</option><option value="off" ${c.reasoning==='off'?'selected':''}>Off</option><option value="simulated" ${c.reasoning==='simulated'?'selected':''}>Simulated · generated private note</option></select><p class="muted">Off and Simulated send the provider's documented switch (OpenGateway: thinking disabled). Simulated also asks for a private note, kept only in research records. Neither is available for Together until a switch is verified.</p><button id="apply-all" class="wide">Apply provider/model/reasoning to all characters</button>`:'';
    const templateHtml=template.length?`<div class="divider"></div><h2>Room template</h2>${template.map(([f,t])=>`<p>${esc(f)} ${t.diverged?'<span class="badge badge-warn">changed here</span>':'<span class="badge">as adopted</span>'}${t.updateAvailable?'<span class="badge badge-update">update available</span>':''}</p>`).join('')}<button id="adopt-template" class="wide">Adopt from template…</button><p class="muted">Adoption covers room instructions, framing and flow, each chosen separately. The cast and opening are never re-applied.</p>`:'';
    panel.innerHTML=`<h2>People</h2><p class="muted">${v2?'v2 assembly: replies are checked against everyone in this room plus your name.':'Legacy assembly: replies are checked against the 8 legacy names. Adding a person or renaming switches this room to v2, after a preview.'}</p><div class="people-list">${ids.map(row).join('')||'<p class="notice">Nobody is in this room yet. Add a person to begin; Continue stays disabled until then.</p>'}</div><button id="add-person" class="wide">＋ Add person</button>${placesPanelHtml(s)}${person}<div class="divider"></div><h2>Shared context</h2><label for="system">Room instructions</label><textarea id="system" rows="6">${esc(s.system)}</textarea>${(()=>{const f=s.frame||boot.legacyFrame,parts=[['identity','Identity line (end of system prompt)',3],['context','Conversation header ({transcript} is the quoted conversation)',2],['opening','When the conversation is empty',1],['turn','Turn instructions (end of user message)',6]];return `<details class="frame-settings" ${s.frame?'open':''}><summary>Harness framing${s.frame?' · customized':''}</summary><p class="muted">Sent with every request, after the room instructions and around the conversation. Placeholders: {speaker}, {participants}, {transcript}. Blank a box to leave that part out.</p>${parts.map(([k,l,r])=>`<label for="frame-${k}">${l}</label><textarea id="frame-${k}" rows="${r}">${esc(f[k])}</textarea>`).join('')}<button type="button" id="frame-reset">Reset to default</button></details>`;})()}${v2?`<label for="history-mode">History</label><select id="history-mode"><option value="transcript">Transcript</option><option value="perspective" ${s.assembly?.history==='perspective'?'selected':''}>Perspective</option></select><p class="muted">Perspective assigns your selected person's own lines to assistant turns. Requires default framing; own images are unsupported. Its effect on these models is a hypothesis.</p><button id="history-preview" ${character?'':'disabled'}>Preview request</button>`:''}<label for="flow">Flow</label><select id="flow"><option value="random">Random speaker</option><option value="alternate" ${s.flow==='alternate'?'selected':''} ${flowOption(s).enabled?'':'disabled'}>${esc(flowOption(s).label)}</option></select><label for="human">Your name in the room</label><input id="human" value="${esc(s.human)}"><label for="policy">Identity checks</label><select id="policy"><option value="protected" ${s.policy==='protected'?'selected':''}>Protect: reject wrong speaker labels</option><option value="observe" ${s.policy==='observe'?'selected':''}>Observe: show reply and flag issues</option></select><label><input id="shadow" type="checkbox" ${s.shadow?'checked':''} ${!boot.keys.jev?'disabled':''}> Jev shadow observations</label><p class="muted">${boot.keys.jev?'One extra API request per turn; may incur provider charges. Jev observes but never selects or adds context.':'Add TYPESAFE_API_KEY to .env to enable optional shadow calls.'}</p><button id="save-settings" class="primary wide">Save settings</button><p class="muted">Edits apply only to this branch. Earlier versions stay inspectable.</p>${templateHtml}`;
    panel.querySelectorAll('[data-person-select]').forEach(b=>b.onclick=action(async()=>{if(settingsChanged())await saveSettings(false);character=b.dataset.personSelect;renderPanel();}));
    panel.querySelectorAll('[data-person-rename]').forEach(b=>b.onclick=action(()=>renamePerson(current,b.dataset.personRename)));
    panel.querySelectorAll('[data-person-adopt]').forEach(b=>b.onclick=action(()=>adoptPersona(current,b.dataset.personAdopt)));
    panel.querySelectorAll('[data-person-active]').forEach(b=>b.onclick=action(async()=>{
      // Rejoining a room with places confirms the old place or sets a new one.
      const k=b.dataset.personActive,on=b.dataset.active==='true',place=on&&s.locations?await choosePlace(s,'Where does '+labelOf(s,k)+' rejoin?',s.locations.at[k]):undefined;if(on&&s.locations&&!place)return;
      await api('/branches/'+current+'/people/'+encodeURIComponent(k)+'/participation',{expected:data.branch.head,active:on,...(place?{place}:{})});$('#panel').dataset.key='';await refresh();}));
    bindPlacesPanel(current);
    panel.querySelectorAll('[data-person-preview]').forEach(b=>b.onclick=action(()=>previewRequest(b.dataset.personPreview)));
    if($('#history-preview'))$('#history-preview').onclick=action(()=>previewRequest(character,settingsBody(false)));
    $('#add-person').onclick=action(()=>addPerson(current));
    if(c){$('#provider').onchange=()=>{const p=$('#provider').value;$('#model').value=p==='demo'?'local-demo':p==='opengateway'?'deepseek/deepseek-flash':'';};$('#apply-all').onclick=action(()=>saveSettings(true));}
    $('#save-settings').onclick=action(()=>saveSettings(false));
    $('#frame-reset').onclick=()=>{for(const k of Object.keys(boot.frame))$('#frame-'+k).value=(v2?boot.legacyFrame:boot.frame)[k];};
    $('#adopt-template')?.addEventListener('click',action(()=>adoptTemplate(current)));
  } else if(tab==='revise') {
    renderReview(panel);
  } else if(tab==='changes') {
    panel.innerHTML=`<h2>${paneChanges?'Left → right pane':'Changes since fork'}</h2>${RoomChanges.render(paneChanges||data.changes?.changes)}${data.changes?.fork&&!paneChanges?'<p class="muted">Derived from the stored fork revision. New edits track their original message IDs. Legacy edits without provenance may appear as removals and additions.</p>':''}`;
  } else if(tab==='inspect') {
    if(data.evidenceLoaded===false){
      panel.innerHTML='<p class="muted">Loading research records…</p>';
      const key=current,version=refreshVersion;
      api('/branches/'+key).then(full=>{if(current!==key||tab!=='inspect'||refreshVersion!==version)return;records.set(key,full);data=full;renderPanel();}).catch(error);
      return;
    }
    const message=s.messages.find(m=>m.id===selected);
    const attempts=message ? data.attempts.filter(a=>a.turnId===message.turnId && message.turnId) : data.attempts;
    const deleted=new Map();for(const revision of data.revisions){const change=revision.change;if(change?.kind==='delete-message'&&!s.messages.some(m=>m.id===change.message.id)&&!deleted.has(change.message.id))deleted.set(change.message.id,revision);}
    const removedHtml=[...deleted.values()].map(r=>`<details><summary>${esc(r.change.message.speaker)} · deleted message</summary><p>${esc(r.change.message.text)}</p><button data-restore-message="${r.id}">Restore message</button></details>`).join('');
    const selections=message ? data.selections.filter(r=>r.id===message.turnId) : data.selections;
    const jev=message ? data.jev.filter(r=>r.turnId===message.turnId) : data.jev;
    panel.innerHTML=`<h2>${message?'Behind this message':'Turn records'}</h2><p class="muted">${message?esc(message.speaker)+' · '+esc(message.source):'Every attempt survives, including failures and rejected replies.'}</p><button id="all-attempts">All attempts</button> <button id="refresh-evidence">Refresh</button>${message?.source==='imported'?'<p class="notice">Historical prompts, selection methods and raw responses were not saved. Current defaults do not reconstruct them.</p>':''}${message?.review?'<p class="notice">This reply replaced the original through Revise. The linked generation is the candidate as generated; you may have edited it when accepting. The original, your feedback and your judgment are under Revise.</p>':message?.source==='edited'?'<p class="notice">This text was retconned. Any linked generation describes the original text, not the edit.</p>':''}${message?.attachments?.length?'<h3>Shared files</h3>'+messageAttachments(message,current):''}${selections.map(r=>details('Selection · '+r.method+' → '+labelOf(s,r.chosen),r)).join('')}${[...attempts].reverse().map(a=>`<details open><summary>${esc(a.persona)} · ${esc(a.provider)} · ${esc(a.outcome?.status||'pending')}<br><span class="muted">${esc(a.body.model)}${a.origin?' · from persona revision '+esc(a.origin.revision.slice(0,8)):''}</span></summary>${details('Identity at dispatch',{personId:a.personId??a.persona,labelAtDispatch:a.labelAtDispatch??a.persona,validationRoster:a.validationRoster??'8 legacy names (recorded before identities were split)',assemblyVersion:a.assemblyVersion??'legacy-v1',origin:a.origin??null})}${a.origin?`<p class="muted">Ran persona revision <code>${esc(a.origin.revision)}</code> <button data-open-vault-item="${esc(a.origin.item)}">Open in vault</button></p>`:''}${a.attachments?.length?details('Attachment inputs sent',a.attachments):''}${details(a.imageDataSummarized?'Dispatched request · image data summarized':'Exact dispatched request', {endpoint:a.endpoint,body:a.body,revision:a.revision,retryOf:a.retryOf})}${a.imageDataSummarized?`<p><a href="/api/attempts/${a.id}/request">Download exact request with image data</a></p>`:''}${a.reasoning?`<details><summary>Reasoning (as returned by provider)</summary><p class="provider-reasoning">${esc(a.reasoning)}</p></details>`:''}${a.outcome?.generatedNote!==undefined?`<details><summary>generated private note</summary><p class="provider-reasoning">${esc(a.outcome.generatedNote)}</p>${details('Provenance',{attempt:a.id,provider:a.provider,model:a.body.model,simulatedReasoning:a.simulatedReasoning})}</details>`:''}${details('Raw response & processing',a.outcome||{status:'pending'})}</details>`).join('')}${jev.map(j=>details('Jev shadow · '+(j.outcome?.status||'pending'),j)).join('')}${!attempts.length?'<p class="muted">No generation attempt for this selection.</p>':''}${removedHtml?'<div class="divider"></div><h2>Deleted messages</h2>'+removedHtml:''}<div class="divider"></div><h2>State history</h2>${data.revisions.slice(0,30).map(r=>details(r.reason+' · '+new Date(r.at).toLocaleTimeString(),r)).join('')}`;
    document.querySelectorAll('[data-restore-message]').forEach(b=>b.onclick=action(async()=>{if(isBusy(current))throw Error('Stop generation before restoring a message.');await api('/branches/'+current+'/messages/restore',{expected:data.branch.head,deletion:b.dataset.restoreMessage});await refresh();}));
    bindAttachmentReaders();
    panel.querySelectorAll('[data-open-vault-item]').forEach(b=>b.onclick=action(async()=>{await openVault(b.dataset.openVaultItem);}));
    $('#all-attempts').onclick=()=>{selected=null;renderPanel();};$('#refresh-evidence').onclick=action(refresh);
  } else {
    panel.innerHTML=`<h2>Field notes</h2><p class="muted">${selected?'Linked to the selected message.':'Linked to the current branch revision.'} Record what happened, your interpretation, alternatives, and what to test next.</p><textarea id="observation" rows="8" placeholder="Observation…&#10;&#10;Possible explanations…&#10;&#10;Next experiment…"></textarea><button id="save-note" class="primary wide">Save observation</button><p><a href="/api/branches/${current}/notebook">Export Markdown</a></p>${data.observations.map(o=>`<div class="note"><span class="muted">${esc(new Date(o.at).toLocaleString())}</span><br>${esc(o.text)}</div>`).join('')}`;
    if(noteDraft)$('#observation').value=noteDraft;
    $('#save-note').onclick=action(async()=>{await api('/branches/'+current+'/observations',{text:$('#observation').value,messageId:selected});$('#observation').value='';await refresh();});
  }
}
async function previewRequest(person,settings){
  const p=await api('/branches/'+current+'/people/'+encodeURIComponent(person)+'/assembled',settings);
  let imageIndex=0;
  const messages=p.messages.map((m,i)=>`<h3>${i+1}. ${esc(m.role)}</h3>${typeof m.content==='string'?`<pre class="compiled">${esc(m.content)}</pre>`:m.content.map(part=>part.type==='text'?`<pre class="compiled">${esc(part.text)}</pre>`:`<p class="notice">Image attachment · ${esc(p.images[imageIndex++]?.name||'image')} (pixels included at this position)</p>`).join('')}`).join('');
  await dialog('Request preview · '+p.label,`<p class="muted">${esc(p.assembly.history)} history${p.adapterVersion?' · '+esc(p.adapterVersion):''}. Ordered request from the dispatch assembler. No model call is made.</p>${messages}`,'Close');
}
// Field-level merge: only the shown person's fields and the shared settings are sent; labels, origins and other people stay as stored.
function settingsBody(all){
  const s=data.branch.revision.state,body={expected:data.branch.head,system:$('#system').value,human:$('#human').value,shadow:$('#shadow').checked,policy:$('#policy').value,flow:$('#flow').value,characters:{}};
  // Persist the selected framing explicitly; legacy rooms retain their old framing until edited.
  if($('#history-mode')&&(s.assembly||$('#history-mode').value!=='transcript'))body.assembly={history:$('#history-mode').value};
  body.frame=Object.fromEntries(Object.keys(boot.frame).map(k=>[k,$('#frame-'+k).value]));
  if(character&&s.characters[character]&&$('#prompt'))body.characters[character]={prompt:$('#prompt').value,situation:$('#situation').value,memory:$('#memory').value,provider:$('#provider').value,model:$('#model').value,temperature:Number($('#temperature').value),reasoning:$('#reasoning').value};
  if(all&&$('#provider'))for(const k of Object.keys(s.characters))body.characters[k]={...body.characters[k],provider:$('#provider').value,model:$('#model').value,temperature:Number($('#temperature').value),reasoning:$('#reasoning').value};
  return body;
}
function settingsChanged(){
  if(!$('#system'))return false;const s=data.branch.revision.state,b=settingsBody(false),c=b.characters[character],o=s.characters[character];
  if((b.assembly?.history||'transcript')!==(s.assembly?.history||'transcript'))return true;
  if(b.system!==s.system||b.human!==s.human||b.shadow!==s.shadow||b.policy!==s.policy||b.flow!==(s.flow||'random')||JSON.stringify(b.frame)!==JSON.stringify(s.frame||boot.legacyFrame))return true;
  return !!c&&!!o&&(c.prompt!==o.prompt||c.situation!==(o.situation||'')||c.memory!==o.memory||c.provider!==o.provider||c.model!==o.model||c.temperature!==o.temperature||c.reasoning!==(o.reasoning||'default'));
}
async function saveSettings(all){await api('/branches/'+current+'/settings',settingsBody(all));$('#panel').dataset.key='';await refresh();}
// Labels a person used to have in this branch's history, for flagging situations that still mention them.
function formerLabels(d){if(d.formerLabels)return new Set(d.formerLabels);const s=d.branch.revision.state,out=new Set();for(const r of d.revisions||[])for(const k of Object.keys(r.state.characters))if(s.characters[k]&&labelOf(r.state,k)!==labelOf(s,k))out.add(labelOf(r.state,k));return out;}
async function addPerson(key){
  const v=await api('/vault'),personas=v.items.filter(i=>i.type==='persona');
  const f=await dialog('Add person',`<label>Label in this room<input name="label" required maxlength="80" placeholder="the judge, movie star #1…"></label><label>From persona<select name="persona"><option value="">Blank (write the prompt yourself)</option>${personas.map(p=>`<option value="${p.id}">${esc(p.title)}${p.archived?' (archived)':''} · revision ${esc(p.head.slice(0,8))}</option>`).join('')}</select></label><label>Situation in this room (optional)<textarea name="situation" rows="3" placeholder="Role, wants and relationships here. Not part of the persona."></textarea></label>${records.get(key).branch.revision.state.locations?`<label>Starts in<select name="place">${placesOf(records.get(key).branch.revision.state).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label><p class="muted">They hear only what is said after they arrive.</p>`:''}<h3>Instantiation</h3><label>Provider<select name="provider">${['opengateway','together',...(boot.keys.demo?['demo']:[])].map(p=>`<option value="${p}">${p==='demo'?'Local demo (no API calls)':p==='together'?'Together':'OpenGateway'}</option>`).join('')}</select></label><label>Model ID<input name="model" value="deepseek/deepseek-flash" required></label><label>Temperature<input name="temperature" type="number" min="0" max="2" step="0.1" value="0.7"></label><label>Reasoning<select name="reasoning"><option value="default">Provider default</option><option value="off">Off</option><option value="simulated">Simulated · generated private note</option></select></label><p class="muted">Two people from one persona are independent: separate labels, situations and memories. Labels: up to 80 characters, one line, no ":".</p>`,'Preview');
  if(!f)return;
  const p=f.get('persona'),input={label:f.get('label').trim(),situation:f.get('situation'),provider:f.get('provider'),model:f.get('model'),temperature:Number(f.get('temperature')),reasoning:f.get('reasoning'),...(f.get('place')?{place:f.get('place')}:{}),...(p?{persona:{item:p,revision:personas.find(x=>x.id===p).head}}:{})};
  const preview=await api('/branches/'+key+'/people/preview',input);
  const ok=await dialog(preview.switchRequired?'Switch this room to v2 and add '+input.label+'?':'Add '+input.label+'?',`${preview.switchRequired?`<p class="notice">This room uses legacy assembly. Adding a person switches it to v2, recorded in the same revision:</p><ul>${preview.switchNotes.map(n=>`<li>${esc(n)}</li>`).join('')}</ul>`:''}<h3>Assembled system message</h3><pre class="compiled">${esc(preview.assembled)||'(empty)'}</pre><p class="muted">No model call is made.</p>`,preview.switchRequired?'Switch to v2 and add':'Add person');
  if(!ok)return;
  await api('/branches/'+key+'/people',{...input,expected:records.get(key).branch.head,switchAssembly:preview.switchRequired});
  $('#panel').dataset.key='';await refresh();
}
async function renamePerson(key,person){
  const rec=records.get(key),s=rec.branch.revision.state,old=labelOf(s,person),legacy=rec.assemblyVersion!=='v2';
  const f=await dialog('Rename '+old,`<label>New label<input name="label" value="${esc(old)}" required maxlength="80"></label><p class="muted">Earlier lines keep the label they were written under. Situations that mention ${esc(old)} are not rewritten; they are flagged for review.</p>${legacy?'<p class="notice">This room uses legacy assembly. Renaming switches it to v2 in the same revision: replies will be checked against the full cast plus your name instead of the 8 legacy names. Earlier revisions keep legacy behavior.</p>':''}`,legacy?'Switch to v2 and rename':'Rename');
  if(!f)return;
  await api('/branches/'+key+'/people/'+encodeURIComponent(person)+'/rename',{expected:rec.branch.head,label:f.get('label').trim(),switchAssembly:legacy});
  $('#panel').dataset.key='';await refresh();
}
async function adoptPersona(key,person){
  const rec=records.get(key),s=rec.branch.revision.state,st=rec.people[person],item=await api('/vault/'+st.origin.item),persona={item:st.origin.item,revision:item.item.head};
  const p=await api('/branches/'+key+'/people/'+encodeURIComponent(person)+'/adopt/preview',{persona});
  const f=await dialog(`Adopt “${item.item.title}” into ${labelOf(s,person)}`,`<p class="muted">Only these fields change, on this branch only. Label, situation, memory and provider settings stay as they are.</p><h3>Personality instructions</h3>${RoomChanges.diff(p.diff)}<h3>Origin</h3><p><code>${esc(p.fields.origin.before?.revision?.slice(0,8)||'none')}</code> → <code>${esc(p.fields.origin.after.revision.slice(0,8))}</code></p>${p.diverged?'<p class="notice">This prompt was edited here. Adopting replaces it with the new compiled text; there is no merge. Cancel to keep your edit.</p>':''}`,p.diverged?'Replace prompt':'Adopt');
  if(!f)return;
  await api('/branches/'+key+'/people/'+encodeURIComponent(person)+'/adopt',{expected:rec.branch.head,persona,replace:p.diverged});
  $('#panel').dataset.key='';await refresh();
}
async function adoptTemplate(key){
  const rec=records.get(key),s=rec.branch.revision.state,itemId=s.origin?.template.item||Object.values(s.templateFields||{})[0]?.item,item=await api('/vault/'+itemId),template={item:itemId,revision:item.item.head};
  const p=await api('/branches/'+key+'/template/preview',{template}),names={system:'Room instructions',frame:'Harness framing',flow:'Flow'};
  const f=await dialog(`Adopt from “${item.item.title}”`,`<p class="muted">Choose each field separately. Unchosen fields, the cast and the opening stay as they are.</p>${Object.entries(p.fields).map(([k,x])=>`<fieldset><legend><label class="inline-check"><input type="checkbox" name="field" value="${k}" ${x.available&&x.changed?'':'disabled'}> ${names[k]}</label></legend>${!x.available?'<p class="muted">Not set in this template.</p>':!x.changed?'<p class="muted">Already the same as the template.</p>':`${x.local?'<p class="notice">Changed here. Adopting replaces your value.</p>':''}${RoomChanges.diff(x.diff)}`}</fieldset>`).join('')}<label class="inline-check"><input type="checkbox" name="replace"> Replace values that were changed here</label>`,'Adopt selected');
  if(!f)return;const fields=f.getAll('field');if(!fields.length)throw Error('Choose at least one field to adopt');
  if(fields.some(k=>p.fields[k].local)&&!f.get('replace'))throw Error('A chosen field was changed here. Tick “Replace values that were changed here”, or leave it out.');
  await api('/branches/'+key+'/template/adopt',{expected:rec.branch.head,template,fields,replace:!!f.get('replace')});
  $('#panel').dataset.key='';await refresh();
}
async function deleteMessage(key,messageId){
  if(isBusy(key))throw Error('Stop generation before deleting a message.');
  const source=records.get(key).branch,message=source.revision.state.messages.find(m=>m.id===messageId);
  const f=await dialog('Delete message?',`<p>Remove this message from <strong>${esc(source.name)}</strong>?</p><blockquote>${esc(message.text.slice(0,240))}${message.text.length>240?'…':''}</blockquote><p class="muted">Later messages and retained memories stay as they are. Future replies will use the remaining history. You can restore the message under Inspect → Deleted messages.</p>`,'Delete message');
  if(!f)return;
  await api('/branches/'+key+'/messages/'+messageId+'/delete',{expected:source.head});selected=null;await refresh();
}
async function forkAt(key,messageId){
  if(isBusy(key))throw Error('Stop this conversation before branching');
  const source=records.get(key).branch;
  const f=await dialog('An alternate continuation','<label>Branch name<input name="name" value="Alternate continuation" required></label>','Create branch');
  if(!f)return;const b=await api('/branches/'+key+'/fork',{revision:source.head,name:f.get('name'),messageId});await replacePane(key,b);
}
async function retcon(key,messageId){
  if(isBusy(key))throw Error('Stop this conversation before retconning');
  const source=records.get(key).branch,m=source.revision.state.messages.find(m=>m.id===messageId);
  const f=await dialog('Change what happened',`<p class="muted">Edits this conversation. Earlier versions remain in Inspect → State history. Branch first if you want a separate continuation. Leave text empty to remove the message.</p><textarea name="text" rows="8">${esc(m.text)}</textarea><label>Continuation<select name="mode"><option value="regenerate">Remove later messages (generate again manually)</option><option value="keep">Keep later messages</option></select></label><label>Memory<select name="memory"><option value="restore">Restore memory recorded at this point</option><option value="keep">Keep current memory as an intervention</option></select></label>`,'Apply retcon');
  if(!f)return;const b=await api('/branches/'+key+'/retcon',{expected:source.head,messageId,text:f.get('text'),mode:f.get('mode'),memory:f.get('memory')});await refresh();
}
async function editHistory(key){
  if(isBusy(key))throw Error('Stop this conversation before editing history');
  const rec=records.get(key),source=rec.branch,s=source.revision.state,ids=Object.keys(s.characters);
  // Attribution is an explicit choice per row; the label text is evidence and is only typed for unbound lines.
  const refValue=r=>!r?'unbound':r.kind==='person'?'person:'+r.id:r.kind,labelFor=v=>v.startsWith('person:')?labelOf(s,v.slice(7)):v==='human'?s.human:v==='narrator'?'Narrator':null;
  const options=sel=>`${ids.map(k=>`<option value="person:${esc(k)}" ${sel==='person:'+k?'selected':''}>${esc(labelOf(s,k))}</option>`).join('')}<option value="human" ${sel==='human'?'selected':''}>You (${esc(s.human)})</option><option value="narrator" ${sel==='narrator'?'selected':''}>Narrator</option><option value="unbound" ${sel==='unbound'?'selected':''}>Unbound · label only</option>`;
  // Existing lines keep who heard them (change that with Who heard this); each new line needs an explicit place or public.
  const scope=m=>!s.locations?'':m.id?`<p class="muted">${locationTag(m)||'public'}</p>`:`<select class="history-audience" aria-label="Who hears this new line"><option value="">Heard where? Choose…</option>${placesOf(s).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}<option value="public">Public · everyone</option></select>`;
  const row=m=>{const sel=m.id?refValue(rec.identity?.[m.id]):'human';return `<div class="history-row" data-original="${esc(m.id||'')}" data-initial="${esc(m.id?sel:'')}">${scope(m)}<select class="history-ref" aria-label="Who said this">${options(sel)}</select><input class="history-speaker" aria-label="Label as written" value="${esc(m.speaker)}" ${sel==='unbound'?'':'readonly'}>${m.attachments?.length?`<p class="muted">${m.attachments.length} attached file(s) retained with this message.</p>`:''}<textarea class="history-text" aria-label="Message text" rows="3">${esc(m.text)}</textarea><button type="button" data-move="up">↑</button> <button type="button" data-move="down">↓</button> <button type="button" data-remove>Remove</button></div>`;};
  const promise=dialog('Retcon · '+source.name,`<p class="muted">Edit, insert, remove, or reorder messages. Text edits keep who said a line; change attribution with the selector. Changes apply to this conversation; earlier versions remain in Inspect → State history. Branch first to keep a separate continuation.</p><div id="history-rows">${s.messages.map(row).join('')}</div><button type="button" id="add-history">＋ Insert message</button><label>Retained memories<select name="memory"><option value="keep">Keep current memories</option><option value="clear">Clear memories</option></select></label>`,'Apply retcon');
  function bind(){document.querySelectorAll('.history-ref').forEach(sel=>sel.onchange=()=>{const input=sel.closest('.history-row').querySelector('.history-speaker'),label=labelFor(sel.value);input.readOnly=label!==null;if(label!==null)input.value=label;});document.querySelectorAll('[data-move]').forEach(b=>b.onclick=()=>{const r=b.closest('.history-row');if(b.dataset.move==='up'&&r.previousElementSibling)r.previousElementSibling.before(r);else if(b.dataset.move==='down'&&r.nextElementSibling)r.nextElementSibling.after(r);});document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>b.closest('.history-row').remove());}
  bind();$('#add-history').onclick=()=>{$('#history-rows').insertAdjacentHTML('beforeend',row({speaker:s.human,text:''}));bind();};
  const f=await promise;if(!f)return;
  const messages=[...document.querySelectorAll('.history-row')].map(r=>{const sel=r.querySelector('.history-ref').value,ref=sel.startsWith('person:')?{kind:'person',id:sel.slice(7)}:{kind:sel};return {id:r.dataset.original||undefined,speaker:r.querySelector('.history-speaker').value,text:r.querySelector('.history-text').value,...(sel!==r.dataset.initial?{speakerRef:ref}:{}),...(()=>{const a=r.querySelector('.history-audience');return !a||!a.value?{}:{audience:a.value==='public'?null:{place:a.value}};})()};});
  const b=await api('/branches/'+key+'/history',{expected:source.head,messages,memory:f.get('memory')});await refresh();
}
async function showFamily(key){
  const root=rootOf(key),members=familyMembers(key);
  const summaries=await Promise.all(members.map(b=>api('/branches/'+b.id+'/changes')));
  const trials=boot.branches.filter(b=>b.isTrial&&rootOf(b.id)?.id===root.id).length;
  const opened=dialog('Branches of '+root.name,`${trials?`<label><input type="checkbox" id="show-trials" ${showTrials?'checked':''} style="width:auto;display:inline"> Show experiment trials (${trials})</label>`:''}<label>Conversation or branch<select name="branch">${members.map((b,i)=>`<option value="${b.id}" ${b.id===key?'selected':''}>${esc(b.name)}${b.id===root.id?' · original':''}${summaries[i].fork?' · '+RoomChanges.badges(summaries[i].changes).slice(0,3).map(esc).join(' · '):''}</option>`).join('')}</select></label>`,'Open');
  $('#show-trials')?.addEventListener('change',ev=>{showTrials=ev.target.checked;localStorage.setItem('room-show-trials',showTrials);$('#dialog').close('cancel');render();showFamily(key).catch(error);});
  const f=await opened;if(!f)return;const target=f.get('branch');
  if(comparison){if((comparison.left===target||comparison.right===target)&&target!==key)throw Error('That branch is already in the other pane');await replacePane(key,{id:target});}else await choose(target);
}
$('#new-experiment').onclick=action(()=>editExperimentDesign());
$('#diff-panes').onclick=action(async()=>{paneChanges=await api('/changes',{left:comparison.left,right:comparison.right});tab='changes';renderPanel();});
// Every new room is v2: empty, or a one-time snapshot of a room template.
$('#new').onclick=action(async()=>{const v=await api('/vault'),templates=v.items.filter(i=>i.type==='room-template'&&!i.archived);
  const f=await dialog('Start a room',`<label>Name<input name="name" value="A new conversation" required></label><label>Start from<select name="template"><option value="">Empty room · add people afterwards</option>${templates.map(t=>`<option value="${t.id}">Template · ${esc(t.title)}</option>`).join('')}</select></label><p class="muted">A template's room instructions, framing, flow, opening and cast are copied once. Later template revisions reach the room only when you adopt them there.</p>`,'Create room');
  if(f){const t=f.get('template'),b=await api('/branches',{name:f.get('name'),...(t?{template:{item:t,revision:templates.find(x=>x.id===t).head}}:{})});await choose(b.id);}});
$('#fork').onclick=action(()=>forkAt(current));$('#history').onclick=action(()=>editHistory(current));
$('#delete').onclick=action(async()=>{
  const source=data.branch,subtree=new Set([source.id]);
  let size;do{size=subtree.size;for(const b of boot.branches)if(subtree.has(b.parent))subtree.add(b.id);}while(size!==subtree.size);
  if([...subtree].some(isBusy))throw Error('Stop generation in this conversation and its branches before deleting it.');
  const f=await dialog(source.parent?'Delete branch?':'Delete conversation?',`<p>Move <strong>${esc(source.name)}</strong>${subtree.size>1?' and its '+(subtree.size-1)+' branches':''} to Trash?</p><p class="muted">You can restore it from the Trash tab. Messages and research records are kept. Saved comparisons keep their own copies.</p>`,'Move to Trash');
  if(!f)return;
  const entry=await api('/branches/'+source.id+'/trash',{expected:source.head});
  for(const key of entry.branches){records.delete(key);drafts.delete(key);}
  selected=null;$('#panel').dataset.key='';await refresh();
});
$('#export').onclick=action(async()=>{
  const key=current;
  await dialog('Export conversation',`<p>A readable transcript with current prompts, or the complete research record.</p><p><a class="file-button" href="/api/branches/${key}/transcript" target="_blank" rel="noopener">PDF · transcript &amp; prompts</a></p><p class="muted">Opens a clean print view. Choose Save as PDF in its print dialog.</p><p><a class="file-button" href="/api/branches/${key}/transcript.md" download>Markdown · transcript</a></p><p><a class="file-button" href="/api/branches/${key}/export" download>JSON · full research record</a></p>`,'Done');
});
$('#import').onchange=action(async e=>{const file=e.target.files[0];if(file){const b=await api('/import',JSON.parse(await file.text()));await choose(b.id);}e.target.value='';});
$('#compare').onclick=action(async()=>{
  if(comparison){if(comparison.dirty)throw Error('Save this comparison before closing, or open another conversation to leave the unsaved pairing.');await choose(current);return;}
  const options=boot.branches.filter(b=>b.id!==current&&!b.comparison);if(!options.length)throw Error('Create another conversation or branch to compare');
  const left=current,choices=options.map(b=>({id:b.id,label:rootOf(b.id).name+(b.parent?' / '+b.name:'')}));
  const pending=dialog('Compare continuations',`<label>Search conversations and branches<input id="compare-search" type="search" placeholder="Type a room or branch name…" autocomplete="off"></label><label>Right conversation<select id="compare-results" name="branch" size="8" required></select></label><p id="compare-count" class="muted" role="status" aria-live="polite"></p>`,'Compare');
  const search=$('#compare-search'),results=$('#compare-results'),submit=$('#dialog-ok');
  function filter(){
    const previous=results.value,terms=search.value.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const matches=choices.filter(c=>terms.every(t=>c.label.normalize('NFKC').toLocaleLowerCase().includes(t)));
    results.innerHTML=matches.map(c=>`<option value="${c.id}">${esc(c.label)}</option>`).join('');
    results.value=matches.some(c=>c.id===previous)?previous:(matches[0]?.id||'');
    submit.disabled=!matches.length;
    $('#compare-count').textContent=matches.length?`${matches.length} of ${choices.length} conversations and branches`:'No matches. Try another name.';
  }
  search.oninput=filter;filter();search.focus();
  let f;try{f=await pending;}finally{submit.disabled=false;}
  if(f&&choices.some(c=>c.id===f.get('branch')))await openComparison(await api('/comparisons/draft',{left,right:f.get('branch')}));
});
$('#save-comparison').onclick=action(async()=>{
  const source={...comparison};
  const f=await dialog('Save comparison',`<label>Name<input name="name" value="${esc(source.id&&!source.draft?source.name:'Conversation comparison')}" required></label><p class="muted">Saves these independent copies. Changes here stay within this comparison; changes to the source conversations stay outside it. Branch comparison copies both sides into another independent comparison.</p>`);
  if(!f)return;
  const saved=await api('/comparisons',{id:source.id,expected:source.version,name:f.get('name'),left:source.left,right:source.right});
  await openComparison(saved);
});
$('#fork-comparison').onclick=action(async()=>{
  const source={...comparison};if(source.dirty)throw Error('Save the changed pairing before branching it');
  if(isBusy(source.left)||isBusy(source.right))throw Error('Stop both panes before branching the comparison');
  const f=await dialog('Branch both conversations',`<label>Name<input name="name" value="${esc(source.name.replace(/(?: · alternative)+$/g,'')+' · alternative')}" required></label><p class="muted">Copies the current prompts, memories and history of both sides. The original comparison stays independent.</p>`,'Branch comparison');
  if(f)await openComparison(await api('/comparisons/'+source.id+'/fork',{expected:source.version,name:f.get('name')}));
});
$('#show-jev').checked=showJev;
$('#show-jev').onchange=()=>{showJev=$('#show-jev').checked;localStorage.setItem('room-show-jev',String(showJev));$('#jev-refresh-status').textContent='';paintJev();scheduleJevPoll();};
$('#refresh-jev').onclick=()=>{clearTimeout(jevTimer);void refreshJevObservations(++jevPollVersion,0,true);};
for(const name of ['conversations','comparisons','experiments','trash','favorites','dislikes'])$('#show-'+name).onclick=()=>{category=name;marked.stale=true;renderLibrary();};
$('#show-vault').onclick=action(()=>openVault());
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;renderPanel();});
action(async()=>{const savedExperiment=localStorage.getItem('room-experiment');if(savedExperiment){try{experimentPage=await api('/experiments/'+savedExperiment);category='experiments';}catch{localStorage.removeItem('room-experiment');}}const saved=localStorage.getItem('room-comparison');if(saved){try{comparison=await api('/comparisons/'+saved);current=comparison.left;}catch{localStorage.removeItem('room-comparison');}}await refresh();if(category==='vault')await openVault();})();
$('#back').onclick=()=>history.back();
