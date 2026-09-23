const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let boot, data, current=localStorage.getItem('room-branch'), tab='characters', character='Boris', selected=null;
let comparison=null, category=localStorage.getItem('room-library')||'conversations', refreshVersion=0;
const records=new Map(), runs=new Map(), drafts=new Map();
async function api(url,body) {const r=await fetch('/api'+url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await r.json();if(!r.ok)throw Error(value.error||'Request failed');return value;}
function error(e){$('#error').textContent=e.message||String(e);$('#error').hidden=false;}
function action(fn){return async(...args)=>{$('#error').hidden=true;try{await fn(...args);}catch(e){error(e);}};}
function dialog(title,html,label='Save'){
  $('#dialog-title').textContent=title;$('#dialog-body').innerHTML=html;$('#dialog-ok').textContent=label;
  return new Promise(resolve=>{const d=$('#dialog');d.onclose=()=>resolve(d.returnValue==='default'?new FormData(d.querySelector('form')):null);d.showModal();});
}
function details(label,obj){return `<details><summary>${esc(label)}</summary><pre>${esc(JSON.stringify(obj,null,2))}</pre></details>`;}
function rootOf(key){let b=boot.branches.find(b=>b.id===key);const visited=new Set();while(b?.parent&&!visited.has(b.id)){visited.add(b.id);const p=boot.branches.find(p=>p.id===b.parent);if(!p)break;b=p;}return b;}
function isBusy(key){return runs.has(key)||boot?.active.includes(key);}
function rememberInputs(){
  document.querySelectorAll('[data-controls]').forEach(el=>{
    if(el.closest('[hidden]'))return;
    const old=drafts.get(el.dataset.controls)||{};
    drafts.set(el.dataset.controls,{...old,text:el.querySelector('[data-text]')?.value||'',speaker:el.querySelector('[data-speaker]')?.value||'',count:el.querySelector('[data-count]')?.value||'1'});
  });
}
async function refresh(){
  rememberInputs();const version=++refreshVersion;
  const next=await api('/bootstrap');
  if(comparison && ![comparison.left,comparison.right].every(key=>next.branches.some(b=>b.id===key))){comparison=null;localStorage.removeItem('room-comparison');}
  if(!next.branches.some(b=>b.id===current)){current=next.branches.find(b=>!b.parent)?.id;selected=null;}
  const ids=comparison?[comparison.left,comparison.right]:current?[current]:[];
  const values=await Promise.all(ids.map(id=>api('/branches/'+id)));
  if(version!==refreshVersion)return;
  boot=next;values.forEach(v=>records.set(v.branch.id,v));data=records.get(current)||null;
  if(current)localStorage.setItem('room-branch',current);else localStorage.removeItem('room-branch');
  render();
}
async function choose(id){rememberInputs();comparison=null;localStorage.removeItem('room-comparison');current=id;selected=null;category='conversations';await refresh();}
async function openComparison(value){
  rememberInputs();comparison=value;current=value.left;selected=null;category='comparisons';
  if(value.id)localStorage.setItem('room-comparison',value.id);else localStorage.removeItem('room-comparison');
  await refresh();
}
function focusPane(key,nextTab=tab,message=null){current=key;data=records.get(key);selected=message;tab=nextTab;renderPanel();document.querySelectorAll('[data-pane]').forEach(p=>p.classList.toggle('focused',p.dataset.pane===key));}
async function replacePane(oldId,next){
  if(comparison){if(comparison.left===oldId)comparison.left=next.id;else if(comparison.right===oldId)comparison.right=next.id;comparison.dirty=true;current=next.id;selected=null;await refresh();}
  else await choose(next.id);
}
function renderLibrary(){
  for(const name of ['conversations','comparisons','trash'])$('#show-'+name).classList.toggle('selected',category===name);
  $('#library-label').textContent=category==='conversations'?'CONVERSATIONS':category==='trash'?'TRASH':'SAVED COMPARISONS';localStorage.setItem('room-library',category);
  if(category==='conversations'){
    const root=rootOf(current);
    $('#branches').innerHTML=boot.branches.filter(b=>!b.parent).map(b=>`<button data-branch="${b.id}" class="${!comparison&&root?.id===b.id?'active':''}">${esc(b.name)}<small>${boot.branches.filter(x=>x.id!==b.id&&rootOf(x.id)?.id===b.id).length} branches</small></button>`).join('')||'<p class="muted">No conversations yet.</p>';
    document.querySelectorAll('[data-branch]').forEach(b=>b.onclick=action(()=>choose(b.dataset.branch)));
  }else if(category==='trash'){
    $('#branches').innerHTML=(boot.trash||[]).map(t=>`<div class="trash-item"><strong>${esc(t.name)}</strong><small>${t.branches.length-1} included branches · ${esc(new Date(t.deletedAt).toLocaleDateString())}</small><button data-restore="${t.id}" ${t.canRestore?'':'disabled'}>Restore</button>${t.canRestore?'':'<small>Restore its parent conversation first.</small>'}</div>`).join('')||'<p class="muted">Trash is empty.</p>';
    document.querySelectorAll('[data-restore]').forEach(b=>b.onclick=action(async()=>{const restored=await api('/trash/'+b.dataset.restore+'/restore',{});await choose(restored.id);}));
  }else{
    $('#branches').innerHTML=(boot.comparisons||[]).map(c=>`<button data-comparison="${c.id}" class="${comparison?.id===c.id?'active':''}">${esc(c.name)}<small>${c.parent?'↳ Comparison branch':'Saved comparison'}</small></button>`).join('')||'<p class="muted">Open two conversations with Compare, then save the comparison.</p>';
    document.querySelectorAll('[data-comparison]').forEach(b=>b.onclick=action(async()=>openComparison(await api('/comparisons/'+b.dataset.comparison))));
  }
}
function messagesHtml(state,key){return state.messages.map(m=>`<article class="message ${m.source==='human'?'human':''}"><div class="avatar">${esc(m.speaker[0])}</div><div><div class="message-head"><strong>${esc(m.speaker)}</strong><span class="badge">${esc(m.source)}</span></div><p>${esc(m.text)}</p><div class="message-actions"><button data-inspect="${m.id}" data-owner="${key}">Inspect</button><button data-fork="${m.id}" data-owner="${key}">Branch here</button><button data-retcon="${m.id}" data-owner="${key}">Retcon</button><button data-note="${m.id}" data-owner="${key}">Observe</button></div></div></article>`).join('')||'<div class="empty"><h2>What should we get into?</h2><p>Add a thought, or let a character begin.</p></div>';}
function controlsHtml(key){
  const s=records.get(key).branch.revision.state,d=drafts.get(key)||{},busy=isBusy(key),run=runs.get(key);
  return `<div class="turn-controls"><label>Next voice <select data-speaker><option value="">Random participant</option>${s.participants.map(p=>`<option ${p===d.speaker?'selected':''}>${p}</option>`).join('')}</select></label><label>Turns <input data-count type="number" value="${esc(d.count||1)}" min="1" max="20"></label><button data-generate="${key}" class="primary" ${busy?'disabled':''}>Continue ↗</button><button data-stop="${key}" ${busy?'':'hidden'}>Stop</button><span class="muted">${run?esc(run.stopping?'Stopping…':`Generating ${run.index} of ${run.count}…`):busy?'Generating…':''}</span></div><form data-compose="${key}"><textarea data-text aria-label="Your message" rows="2" placeholder="Say something to this conversation…">${esc(d.text||'')}</textarea><button class="primary" type="submit" ${busy?'disabled':''}>Send</button></form>`;
}
function render(){
  rememberInputs();renderLibrary();$('#connection').textContent=`OpenGateway ${boot.keys.opengateway?'● ready':'○ no key'} · Together ${boot.keys.together?'● ready':'○ no key'}`;
  document.querySelector('.workspace').classList.toggle('comparing',!!comparison);
  $('#messages').hidden=!!comparison;$('#comparison').hidden=!comparison;document.querySelector('main > footer').hidden=!!comparison||!data;
  for(const key of ['family','fork','history','compare','export','delete'])$('#'+key).disabled=!data;
  for(const key of ['family','fork','history','export','delete'])$('#'+key).hidden=!!comparison;
  $('#save-comparison').hidden=!comparison;$('#fork-comparison').hidden=!comparison?.id;
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
    $('#title').textContent=comparison.name||'Compare conversations';$('#subtitle').textContent='Two live conversations · controls apply to their own pane';
    const positions=new Map([...document.querySelectorAll('[data-pane]')].map(p=>[p.dataset.pane,p.querySelector('.pane-messages').scrollTop]));
    $('#comparison').innerHTML=[comparison.left,comparison.right].map((key,index)=>{
      const b=records.get(key).branch;
      return `<section class="comparison-pane ${key===current?'focused':''}" data-pane="${key}" aria-label="${index?'Right':'Left'} conversation"><div class="pane-header"><div class="eyebrow">${index?'RIGHT':'LEFT'} CONVERSATION</div><h2>${esc(b.name)}</h2><div class="pane-actions"><button data-settings="${key}">Characters & settings</button><button data-pane-fork="${key}">Branch</button><button data-history="${key}">Edit history</button><button data-family="${key}">Branches</button></div></div><div class="pane-messages">${messagesHtml(b.revision.state,key)}</div><div class="pane-footer" data-controls="${key}">${controlsHtml(key)}</div></section>`;
    }).join('');
    document.querySelectorAll('[data-pane]').forEach(p=>{if(positions.has(p.dataset.pane))p.querySelector('.pane-messages').scrollTop=positions.get(p.dataset.pane);});
  }else{
    const b=data.branch,s=b.revision.state,root=rootOf(b.id);
    $('#title').textContent=b.name;$('#subtitle').textContent=`${s.participants.length} participants · ${s.messages.length} messages${b.parent?' · Branch of '+root.name:''}`;
    $('#family').textContent=`Branches (${boot.branches.filter(x=>x.id!==root.id&&rootOf(x.id)?.id===root.id).length})`;
    $('#messages').innerHTML=messagesHtml(s,current);
    const footer=document.querySelector('main > footer');footer.dataset.controls=current;footer.innerHTML=controlsHtml(current)+'<div class="footnote">Sending adds your message. Continue gives a character the floor.</div>';
  }
  bindControls();renderPanel(false);
}
function bindControls(){
  document.querySelectorAll('[data-inspect]').forEach(b=>b.onclick=()=>focusPane(b.dataset.owner,'inspect',b.dataset.inspect));
  document.querySelectorAll('[data-note]').forEach(b=>b.onclick=()=>focusPane(b.dataset.owner,'notes',b.dataset.note));
  document.querySelectorAll('[data-fork]').forEach(b=>b.onclick=action(()=>forkAt(b.dataset.owner,b.dataset.fork)));
  document.querySelectorAll('[data-retcon]').forEach(b=>b.onclick=action(()=>retcon(b.dataset.owner,b.dataset.retcon)));
  document.querySelectorAll('[data-settings]').forEach(b=>b.onclick=()=>focusPane(b.dataset.settings,'characters'));
  document.querySelectorAll('[data-pane-fork]').forEach(b=>b.onclick=action(()=>forkAt(b.dataset.paneFork)));
  document.querySelectorAll('[data-history]').forEach(b=>b.onclick=action(()=>editHistory(b.dataset.history)));
  document.querySelectorAll('[data-family]').forEach(b=>b.onclick=action(()=>showFamily(b.dataset.family)));
  document.querySelectorAll('[data-generate]').forEach(b=>b.onclick=action(()=>runTurns(b.dataset.generate)));
  document.querySelectorAll('[data-stop]').forEach(b=>b.onclick=action(async()=>{const run=runs.get(b.dataset.stop);if(run)run.stopping=true;await api('/branches/'+b.dataset.stop+'/stop',{});await refresh();}));
  document.querySelectorAll('[data-compose]').forEach(f=>f.onsubmit=action(async e=>{e.preventDefault();const key=f.dataset.compose,text=f.querySelector('[data-text]').value;rememberInputs();const snap=records.get(key);await api('/branches/'+key+'/messages',{expected:snap.branch.head,text});f.querySelector('[data-text]').value='';drafts.set(key,{...drafts.get(key),text:''});await refresh();scrollMessages(key);}));
  document.querySelectorAll('[data-text]').forEach(t=>t.onkeydown=e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey))t.closest('form').requestSubmit();});
}
function scrollMessages(key){const pane=document.querySelector(`[data-pane="${key}"] .pane-messages`);const el=pane||(!comparison&&key===current?$('#messages'):null);if(el)el.scrollTop=el.scrollHeight;}
async function runTurns(key){
  if(isBusy(key))return;rememberInputs();const d=drafts.get(key)||{},count=Number(d.count||1),speaker=d.speaker||'';
  if(!Number.isInteger(count)||count<1||count>20)throw Error('Choose 1–20 turns');
  const run={id:crypto.randomUUID(),count,index:1,stopping:false};runs.set(key,run);render();
  try{for(let n=0;n<count&&!run.stopping;n++){run.index=n+1;const snap=await api('/branches/'+key);if(run.stopping)break;await api('/branches/'+key+'/turn',{expected:snap.branch.head,speaker,run:{id:run.id,index:n+1,count}});await refresh();scrollMessages(key);}}
  finally{runs.delete(key);await refresh();}
}
function renderPanel(force = true) {
  document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('selected',b.dataset.tab===tab));
  if(!data)return;
  const s=data.branch.revision.state, panel=$('#panel');
  $('#panel-context').textContent=(comparison ? (current===comparison.left?'Left':'Right')+' pane · ' : '')+data.branch.name;
  const panelKey=current+':'+tab+':'+character;
  if(!force && tab==='characters' && panel.dataset.key===panelKey)return;
  const noteDraft=tab==='notes' && panel.dataset.key===panelKey ? $('#observation')?.value : '';
  panel.dataset.key=panelKey;
  if(tab==='characters') {
    const c=s.characters[character];
    panel.innerHTML=`<h2>The cast</h2><div class="checks">${Object.keys(s.characters).map(p=>`<label><input type="checkbox" name="participant" value="${p}" ${s.participants.includes(p)?'checked':''}> ${p}</label>`).join('')}</div><div class="divider"></div><label for="character">Character</label><select id="character">${Object.keys(s.characters).map(p=>`<option ${p===character?'selected':''}>${p}</option>`).join('')}</select><label for="prompt">Personality instructions</label><textarea id="prompt" rows="9">${esc(c.prompt)}</textarea><label for="memory">Retained memory · edited by you</label><textarea id="memory" rows="3">${esc(c.memory)}</textarea><label for="provider">Provider</label><select id="provider">${['demo','opengateway','together'].map(p=>`<option value="${p}" ${p===c.provider?'selected':''}>${p==='demo'?'Local demo (no API calls)':p==='together'?'Together':'OpenGateway'}</option>`).join('')}</select><label for="model">Model ID</label><input id="model" value="${esc(c.model)}" placeholder="Exact provider model identifier"><label for="temperature">Temperature</label><input id="temperature" type="number" min="0" max="2" step="0.1" value="${c.temperature}"><button id="apply-all" class="wide">Apply provider/model to all characters</button><div class="divider"></div><h2>Shared context</h2><label for="system">Room instructions</label><textarea id="system" rows="6">${esc(s.system)}</textarea><label for="human">Your name in the room</label><input id="human" value="${esc(s.human)}"><label for="policy">Identity checks</label><select id="policy"><option value="protected" ${s.policy==='protected'?'selected':''}>Protect: reject wrong speaker labels</option><option value="observe" ${s.policy==='observe'?'selected':''}>Observe: show reply and flag issues</option></select><label><input id="shadow" type="checkbox" ${s.shadow?'checked':''} ${!boot.keys.jev?'disabled':''}> Jev shadow observations</label><p class="muted">${boot.keys.jev?'One extra API request per turn; may incur provider charges. Jev observes but never selects or adds context.':'Add TYPESAFE_API_KEY to .env to enable optional shadow calls.'}</p><button id="save-settings" class="primary wide">Save settings</button><p class="muted">Edits apply only to this branch. Earlier versions stay inspectable.</p>`;
    $('#character').onchange=action(async e=>{await saveSettings(false);character=e.target.value;renderPanel();});
    $('#provider').onchange=()=>{const p=$('#provider').value;$('#model').value=p==='demo'?'local-demo':p==='opengateway'?'moonshotai/kimi-k3-ultrafast':'';};
    $('#save-settings').onclick=action(()=>saveSettings(false));
    $('#apply-all').onclick=action(()=>saveSettings(true));
  } else if(tab==='inspect') {
    const message=s.messages.find(m=>m.id===selected);
    const attempts=message ? data.attempts.filter(a=>a.turnId===message.turnId && message.turnId) : data.attempts;
    const turnIds=new Set(attempts.map(a=>a.turnId));
    const selections=message ? data.selections.filter(r=>r.id===message.turnId) : data.selections;
    const jev=message ? data.jev.filter(r=>r.turnId===message.turnId) : data.jev;
    panel.innerHTML=`<h2>${message?'Behind this message':'Turn records'}</h2><p class="muted">${message?esc(message.speaker)+' · '+esc(message.source):'Every attempt survives, including failures and rejected replies.'}</p><button id="all-attempts">All attempts</button> <button id="refresh-evidence">Refresh</button>${message?.source==='imported'?'<p class="notice">Historical prompts, selection methods and raw responses were not saved. Current defaults do not reconstruct them.</p>':''}${message?.source==='edited'?'<p class="notice">This text was retconned. Any linked generation describes the original text, not the edit.</p>':''}${selections.map(r=>details('Selection · '+r.method+' → '+r.chosen,r)).join('')}${[...attempts].reverse().map(a=>`<details open><summary>${esc(a.persona)} · ${esc(a.provider)} · ${esc(a.outcome?.status||'pending')}<br><span class="muted">${esc(a.body.model)}</span></summary>${details('Exact dispatched request', {endpoint:a.endpoint,body:a.body,revision:a.revision,retryOf:a.retryOf})}${details('Raw response & processing',a.outcome||{status:'pending'})}</details>`).join('')}${jev.map(j=>details('Jev shadow · '+(j.outcome?.status||'pending'),j)).join('')}${!attempts.length?'<p class="muted">No generation attempt for this selection.</p>':''}<div class="divider"></div><h2>State history</h2>${data.revisions.slice(0,30).map(r=>details(r.reason+' · '+new Date(r.at).toLocaleTimeString(),r)).join('')}`;
    $('#all-attempts').onclick=()=>{selected=null;renderPanel();};$('#refresh-evidence').onclick=action(refresh);
  } else {
    panel.innerHTML=`<h2>Field notes</h2><p class="muted">${selected?'Linked to the selected message.':'Linked to the current branch revision.'} Record what happened, your interpretation, alternatives, and what to test next.</p><textarea id="observation" rows="8" placeholder="Observation…&#10;&#10;Possible explanations…&#10;&#10;Next experiment…"></textarea><button id="save-note" class="primary wide">Save observation</button><p><a href="/api/branches/${current}/notebook">Export Markdown</a></p>${data.observations.map(o=>`<div class="note"><span class="muted">${esc(new Date(o.at).toLocaleString())}</span><br>${esc(o.text)}</div>`).join('')}`;
    if(noteDraft)$('#observation').value=noteDraft;
    $('#save-note').onclick=action(async()=>{await api('/branches/'+current+'/observations',{text:$('#observation').value,messageId:selected});$('#observation').value='';await refresh();});
  }
}
async function saveSettings(all) {
  const s=structuredClone(data.branch.revision.state);
  s.participants=[...document.querySelectorAll('[name=participant]:checked')].map(x=>x.value);
  s.characters[character]={prompt:$('#prompt').value,memory:$('#memory').value,provider:$('#provider').value,model:$('#model').value,temperature:Number($('#temperature').value)};
  if(all) for(const c of Object.values(s.characters)) { c.provider=$('#provider').value;c.model=$('#model').value;c.temperature=Number($('#temperature').value); }
  s.system=$('#system').value;s.human=$('#human').value;s.shadow=$('#shadow').checked;s.policy=$('#policy').value;
  await api('/branches/'+current+'/settings',{...s,expected:data.branch.head});$('#panel').dataset.key='';await refresh();
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
  const f=await dialog('Change what happened',`<p class="muted">Creates a new branch in this pane. The original stays intact. Leave text empty to remove the message.</p><textarea name="text" rows="8">${esc(m.text)}</textarea><label>Continuation<select name="mode"><option value="regenerate">Regenerate from this point</option><option value="keep">Keep later messages</option></select></label><label>Memory<select name="memory"><option value="restore">Restore memory recorded at this point</option><option value="keep">Keep current memory as an intervention</option></select></label>`,'Create retcon branch');
  if(!f)return;const b=await api('/branches/'+key+'/retcon',{expected:source.head,messageId,text:f.get('text'),mode:f.get('mode'),memory:f.get('memory')});await replacePane(key,b);
}
async function editHistory(key){
  if(isBusy(key))throw Error('Stop this conversation before editing history');
  const source=records.get(key).branch,s=source.revision.state;
  const row=m=>`<div class="history-row" data-original="${esc(m.id||'')}"><input class="history-speaker" aria-label="Speaker" value="${esc(m.speaker)}"><textarea class="history-text" aria-label="Message text" rows="3">${esc(m.text)}</textarea><button type="button" data-move="up">↑</button> <button type="button" data-move="down">↓</button> <button type="button" data-remove>Remove</button></div>`;
  const promise=dialog('Retcon · '+source.name,`<p class="muted">Edit, insert, remove, or reorder messages. A new branch replaces this pane; the other side stays as it is.</p><div id="history-rows">${s.messages.map(row).join('')}</div><button type="button" id="add-history">＋ Insert message</button><label>Retained memories<select name="memory"><option value="keep">Keep current memories</option><option value="clear">Clear memories in the new branch</option></select></label>`,'Create retcon branch');
  function bind(){document.querySelectorAll('[data-move]').forEach(b=>b.onclick=()=>{const r=b.closest('.history-row');if(b.dataset.move==='up'&&r.previousElementSibling)r.previousElementSibling.before(r);else if(b.dataset.move==='down'&&r.nextElementSibling)r.nextElementSibling.after(r);});document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>b.closest('.history-row').remove());}
  bind();$('#add-history').onclick=()=>{$('#history-rows').insertAdjacentHTML('beforeend',row({speaker:s.human,text:''}));bind();};
  const f=await promise;if(!f)return;
  const messages=[...document.querySelectorAll('.history-row')].map(r=>({id:r.dataset.original,speaker:r.querySelector('.history-speaker').value,text:r.querySelector('.history-text').value}));
  const b=await api('/branches/'+key+'/history',{expected:source.head,messages,memory:f.get('memory')});await replacePane(key,b);
}
async function showFamily(key){
  const root=rootOf(key),members=boot.branches.filter(b=>rootOf(b.id)?.id===root.id);
  const f=await dialog('Branches of '+root.name,`<label>Conversation or branch<select name="branch">${members.map(b=>`<option value="${b.id}" ${b.id===key?'selected':''}>${esc(b.name)}${b.id===root.id?' · original':''}</option>`).join('')}</select></label>`,'Open');
  if(!f)return;const target=f.get('branch');
  if(comparison){if((comparison.left===target||comparison.right===target)&&target!==key)throw Error('That branch is already in the other pane');await replacePane(key,{id:target});}else await choose(target);
}
$('#new').onclick=action(async()=>{const f=await dialog('Start a room','<label>Name<input name="name" value="A new conversation" required></label>','Create room');if(f){const b=await api('/branches',{name:f.get('name')});await choose(b.id);}});
$('#fork').onclick=action(()=>forkAt(current));$('#history').onclick=action(()=>editHistory(current));$('#family').onclick=action(()=>showFamily(current));
$('#delete').onclick=action(async()=>{
  const source=data.branch,subtree=new Set([source.id]);
  let size;do{size=subtree.size;for(const b of boot.branches)if(subtree.has(b.parent))subtree.add(b.id);}while(size!==subtree.size);
  if([...subtree].some(isBusy))throw Error('Stop generation in this conversation and its branches before deleting it.');
  const f=await dialog(source.parent?'Delete branch?':'Delete conversation?',`<p>Move <strong>${esc(source.name)}</strong>${subtree.size>1?' and its '+(subtree.size-1)+' branches':''} to Trash?</p><p class="muted">You can restore it from the Trash tab. Messages and research records are kept. Comparisons using these branches will be hidden until restored.</p>`,'Move to Trash');
  if(!f)return;
  const entry=await api('/branches/'+source.id+'/trash',{expected:source.head});
  for(const key of entry.branches){records.delete(key);drafts.delete(key);}
  selected=null;$('#panel').dataset.key='';await refresh();
});
$('#export').onclick=()=>{location.href='/api/branches/'+current+'/export';};
$('#import').onchange=action(async e=>{const file=e.target.files[0];if(file){const b=await api('/import',JSON.parse(await file.text()));await choose(b.id);}e.target.value='';});
$('#compare').onclick=action(async()=>{
  if(comparison){if(comparison.dirty)throw Error('Save this comparison before closing, or open another conversation to leave the unsaved pairing.');await choose(current);return;}
  const options=boot.branches.filter(b=>b.id!==current);if(!options.length)throw Error('Create another conversation or branch to compare');
  const f=await dialog('Compare continuations',`<label>Right conversation<select name="branch">${options.map(b=>`<option value="${b.id}">${esc(rootOf(b.id).name)}${b.parent?' / '+esc(b.name):''}</option>`).join('')}</select></label>`,'Compare');
  if(f)await openComparison({left:current,right:f.get('branch'),name:'Unsaved comparison',dirty:false});
});
$('#save-comparison').onclick=action(async()=>{
  const source={...comparison};
  const f=await dialog('Save comparison',`<label>Name<input name="name" value="${esc(source.id?source.name:'Conversation comparison')}" required></label><p class="muted">Saves this pair of live branches. Messages and edits persist automatically. Branch comparison makes independent copies of both sides.</p>`);
  if(!f)return;
  const saved=await api('/comparisons',{id:source.id,expected:source.version,name:f.get('name'),left:source.left,right:source.right});
  comparison=saved;category='comparisons';localStorage.setItem('room-comparison',saved.id);await refresh();
});
$('#fork-comparison').onclick=action(async()=>{
  const source={...comparison};if(source.dirty)throw Error('Save the changed pairing before branching it');
  if(isBusy(source.left)||isBusy(source.right))throw Error('Stop both panes before branching the comparison');
  const f=await dialog('Branch both conversations',`<label>Name<input name="name" value="${esc(source.name+' · alternative')}" required></label><p class="muted">Copies the current prompts, memories and history of both sides. The original comparison stays independent.</p>`,'Branch comparison');
  if(f)await openComparison(await api('/comparisons/'+source.id+'/fork',{expected:source.version,name:f.get('name')}));
});
for(const name of ['conversations','comparisons','trash'])$('#show-'+name).onclick=()=>{category=name;renderLibrary();};
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;renderPanel();});
action(async()=>{const saved=localStorage.getItem('room-comparison');if(saved){try{comparison=await api('/comparisons/'+saved);current=comparison.left;}catch{localStorage.removeItem('room-comparison');}}await refresh();})();
