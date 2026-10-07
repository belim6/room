/* Locations (stage 1.6): tags, view filter, Move, Narration, audience edits and place settings. Nothing here calls a model.
   Who heard a line is decided by the server when it is stamped; these views only read it. */
const roomViews=new Map();
const placesOf=s=>s.locations?.places||[];
const placeNameOf=(s,id)=>placesOf(s).find(p=>p.id===id)?.name||'?';
const localCastOf=(s,place)=>s.participants.filter(p=>s.locations.at[p]===place);
const whoOf=(s,k)=>k==='human'?s.human:labelOf(s,k);
const everyoneOf=s=>[...Object.keys(s.characters),'human'];
// Tags render the snapshot stamped with the line, so later renames don't rewrite history.
function locationTag(m){
  const tags=[];
  if(m.movement)tags.push(`<span class="scope-tag move" title="Movement">moved · ${esc(m.movement.display.movers.join(', '))}: ${esc(m.movement.display.from)} → ${esc(m.movement.display.to)}</span>`);
  if(m.audience)tags.push(`<span class="scope-tag" title="Who heard this, as stamped">${esc(m.audience.display.place)} · ${esc(m.audience.display.present.join(', ')||'nobody')}</span>`);
  return tags.join('');
}
// One place: lines located there, public lines, and moves into or out of it. "As seen by": the server's projection.
function viewKeep(s,key){
  const v=roomViews.get(key);
  if(!s.locations||!v||v.mode==='all')return ()=>true;
  if(v.mode==='place')return m=>!m.audience||m.audience.place===v.place||(m.movement&&(m.movement.from===v.place||m.movement.to===v.place));
  return m=>!!v.seen?.has(m.id);
}
async function refreshSeen(key){
  const v=roomViews.get(key),rec=records.get(key);
  if(v?.mode!=='seen'||!rec?.branch.revision.state.locations)return;
  const r=await api(`/branches/${key}/seen/${encodeURIComponent(v.person)}`);v.seen=new Set(r.visibleMessageIds);v.info=r;
}
function viewHtml(key){
  const s=records.get(key).branch.revision.state;if(!s.locations)return '';
  const v=roomViews.get(key)||{mode:'all'},value=v.mode==='all'?'all':v.mode==='place'?'place:'+v.place:'seen:'+v.person;
  const option=(val,label)=>`<option value="${esc(val)}" ${val===value?'selected':''}>${esc(label)}</option>`;
  const note=v.mode==='seen'&&v.info?`<span class="muted">${esc(v.info.label)}’s next request history at revision ${esc(v.info.revision.slice(0,8))} · ${v.info.hidden} hidden</span>`:'';
  return `<div class="view-bar"><label>View <select data-view="${key}">${option('all','Everything')}<optgroup label="One place">${placesOf(s).map(p=>option('place:'+p.id,p.name)).join('')}</optgroup><optgroup label="As seen by">${everyoneOf(s).map(k=>option('seen:'+k,whoOf(s,k)+(k==='human'?' (you)':''))).join('')}</optgroup></select></label>${note}</div>`;
}
// The run's place: Deniz's choice in this control, defaulting to the place being viewed, then to where the human is.
function chosenPlace(key){
  const s=records.get(key).branch.revision.state,d=drafts.get(key)||{},v=roomViews.get(key);
  if(d.place==='rotate'||placesOf(s).some(p=>p.id===d.place))return d.place;
  return v?.mode==='place'?v.place:s.locations.at.human;
}
function placeControlsHtml(key){
  const s=records.get(key).branch.revision.state,place=chosenPlace(key);
  return `<label>Place <select data-place>${placesOf(s).map(p=>`<option value="${esc(p.id)}" ${p.id===place?'selected':''}>${esc(p.name)} · ${localCastOf(s,p.id).length}</option>`).join('')}<option value="rotate" ${place==='rotate'?'selected':''}>Rotate between places</option></select></label>`;
}
function placeActionsHtml(key){return `<button type="button" data-move-people="${key}">Move people…</button><button type="button" data-narrate="${key}">Narrate…</button>`;}
function speakingInHtml(key){const s=records.get(key).branch.revision.state;return s.locations?`<div class="speaking-in muted">Speaking in: <strong>${esc(placeNameOf(s,s.locations.at.human))}</strong> · heard by ${esc(localCastOf(s,s.locations.at.human).map(p=>labelOf(s,p)).join(', ')||'nobody else')}</div>`:'';}
function bindPlaceControls(){
  document.querySelectorAll('[data-view]').forEach(sel=>sel.onchange=action(async()=>{
    const key=sel.dataset.view,[mode,arg]=sel.value.split(/:(.*)/s);
    roomViews.set(key,mode==='all'?{mode}:mode==='place'?{mode,place:arg}:{mode,person:arg});
    await refreshSeen(key);render();
  }));
  document.querySelectorAll('[data-place]').forEach(sel=>sel.onchange=()=>{rememberInputs();render();});
  document.querySelectorAll('[data-move-people]').forEach(b=>b.onclick=action(()=>movePeople(b.dataset.movePeople)));
  document.querySelectorAll('[data-narrate]').forEach(b=>b.onclick=action(()=>narrate(b.dataset.narrate)));
  document.querySelectorAll('[data-audience]').forEach(b=>b.onclick=action(()=>editAudience(b.dataset.owner,b.dataset.audience)));
}
async function latestHead(key){return isBusy(key)?(await api('/branches/'+key)).branch.head:records.get(key).branch.head;}
async function movePeople(key){
  const s=records.get(key).branch.revision.state;
  const groups=placesOf(s).map(p=>{const here=[...localCastOf(s,p.id),...(s.locations.at.human===p.id?['human']:[])];return here.length?`<fieldset><legend>${esc(p.name)}</legend>${here.map(k=>`<label class="inline-check"><input type="checkbox" name="mover" value="${esc(k)}"> ${esc(whoOf(s,k))}${k==='human'?' (you)':''}</label>`).join(' ')}</fieldset>`:'';}).join('');
  const f=await dialog('Move people',`<p class="muted">Everyone moving together starts in one place. Inactive people change place when they rejoin.</p>${groups}<label>To<select name="to">${placesOf(s).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}<option value="">A new place…</option></select></label><label>New place name (only for a new place)<input name="newPlace" maxlength="40"></label>`,'Preview');
  if(!f)return;
  const movers=f.getAll('mover'),to=f.get('to'),input={movers,...(to?{to}:{newPlace:f.get('newPlace')})};
  const p=await api('/branches/'+key+'/move/preview',input);
  const ok=await dialog('Post the movement line?',`<p class="muted">One revision: placement changes and this narrator line is added. It is heard by everyone in ${esc(p.movement.display.from)} and ${esc(p.movement.display.to)}, movers included. It interrupts a running run.</p><p>${locationTag({audience:p.audience})}</p><label>Movement line<textarea name="text" rows="3">${esc(p.text)}</textarea></label>`,'Move');
  if(!ok)return;
  await api('/branches/'+key+'/move',{...input,text:ok.get('text'),expected:await latestHead(key)});await refresh();
}
async function narrate(key){
  const s=records.get(key).branch.revision.state;
  const f=await dialog('Narrate',`<label>Narration<textarea name="text" rows="4" required></textarea></label><label>Heard in<select name="place">${placesOf(s).map(p=>`<option value="${esc(p.id)}" ${p.id===chosenPlace(key)?'selected':''}>${esc(p.name)} · ${esc([...localCastOf(s,p.id).map(k=>labelOf(s,k)),...(s.locations.at.human===p.id?[s.human]:[])].join(', ')||'nobody')}</option>`).join('')}<option value="">Public · everyone</option></select></label><p class="muted">A narrator line is heard by whoever is in that place now, or by everyone if public. It interrupts a running run; it is not a message from you.</p>`,'Narrate');
  if(!f)return;
  await api('/branches/'+key+'/narration',{expected:await latestHead(key),text:f.get('text'),place:f.get('place')||null});await refresh();
}
async function editAudience(key,messageId){
  if(isBusy(key))throw Error('Stop generation before changing who heard a line.');
  const rec=records.get(key),s=rec.branch.revision.state,m=s.messages.find(x=>x.id===messageId),present=new Set(m.audience?.present||everyoneOf(s));
  const f=await dialog('Who heard this line?',`<blockquote>${esc(m.text.slice(0,240))}</blockquote><p class="muted">An explicit audience edit. It takes a new snapshot at this revision; text and attribution stay as they are.</p><label class="inline-check"><input type="checkbox" name="public" ${m.audience?'':'checked'}> Public · everyone</label><label>Place<select name="place">${placesOf(s).map(p=>`<option value="${esc(p.id)}" ${p.id===(m.audience?.place||s.locations.at.human)?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><fieldset><legend>Heard by</legend>${everyoneOf(s).map(k=>`<label class="inline-check"><input type="checkbox" name="present" value="${esc(k)}" ${present.has(k)?'checked':''}> ${esc(whoOf(s,k))}</label>`).join(' ')}</fieldset>`,'Preview');
  if(!f)return;
  const audience=f.get('public')?null:{place:f.get('place'),present:f.getAll('present')};
  const p=await api('/branches/'+key+'/messages/'+messageId+'/audience/preview',{audience});
  const ok=await dialog('Change who heard this?',`<p>Gains this line: <strong>${esc(p.gained.join(', ')||'nobody')}</strong></p><p>Loses this line: <strong>${esc(p.lost.join(', ')||'nobody')}</strong></p><p class="muted">Applies to future requests on this branch. Earlier requests and revisions are unchanged.</p>`,'Apply');
  if(!ok)return;
  await api('/branches/'+key+'/messages/'+messageId+'/audience',{expected:rec.branch.head,audience});await refresh();
}
async function choosePlace(s,title,current){
  const f=await dialog(title,`<label>Place<select name="place">${placesOf(s).map(p=>`<option value="${esc(p.id)}" ${p.id===current?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><p class="muted">They hear only what is said after they arrive.</p>`,'Choose');
  return f?f.get('place'):null;
}
function placesPanelHtml(s){
  if(!s.locations)return `<div class="divider"></div><h2>Places</h2><p class="muted">Everyone hears everything. With places, each person's model receives only the lines they were present for.</p><button id="enable-locations" class="wide">Add places…</button>`;
  return `<div class="divider"></div><h2>Places</h2>${placesOf(s).map(p=>`<div class="person-row"><strong>${esc(p.name)}</strong> <button type="button" class="link-button" data-place-rename="${esc(p.id)}">Rename</button><div class="muted">${esc([...localCastOf(s,p.id).map(k=>labelOf(s,k)),...(s.locations.at.human===p.id?[s.human+' (you)']:[])].join(', ')||'nobody active')}</div></div>`).join('')}<p class="muted">Move people with Move people… under the conversation. Places can't be removed, and locations can't be turned off, in this release.</p>`;
}
function bindPlacesPanel(key){
  $('#enable-locations')?.addEventListener('click',action(()=>enableLocations(key)));
  document.querySelectorAll('[data-place-rename]').forEach(b=>b.onclick=action(async()=>{
    const rec=records.get(key),s=rec.branch.revision.state,old=placeNameOf(s,b.dataset.placeRename);
    const f=await dialog('Rename '+old,`<label>New name<input name="name" value="${esc(old)}" maxlength="40" required></label><p class="muted">Lines already said keep “${esc(old)}” in their tags.</p>`,'Rename');
    if(!f)return;await api('/branches/'+key+'/locations/places/'+encodeURIComponent(b.dataset.placeRename)+'/rename',{expected:rec.branch.head,name:f.get('name')});$('#panel').dataset.key='';await refresh();
  }));
}
async function enableLocations(key){
  const rec=records.get(key),s=rec.branch.revision.state;
  const f=await dialog('Add places',`<label>Places, one per line<textarea name="places" rows="4" required placeholder="the table&#10;the hall"></textarea></label><p class="muted">Names: up to 40 characters, no ":".</p>`,'Next');
  if(!f)return;const names=f.get('places').split('\n').map(x=>x.trim()).filter(Boolean);if(!names.length)throw Error('Name at least one place');
  const g=await dialog('Where is everyone?',`${everyoneOf(s).map(k=>`<label>${esc(whoOf(s,k))}${k==='human'?' (you)':s.participants.includes(k)?'':' · inactive'}<select name="at:${esc(k)}">${names.map(n=>`<option>${esc(n)}</option>`).join('')}</select></label>`).join('')}`,'Preview');
  if(!g)return;const at=Object.fromEntries(everyoneOf(s).map(k=>[k,g.get('at:'+k)]));
  const p=await api('/branches/'+key+'/locations/preview',{places:names,at});
  const ok=await dialog('Add these places?',`${p.switchRequired?`<p class="notice">This room uses legacy assembly. Places need v2, switched in the same revision:</p><ul>${p.switchNotes.map(n=>`<li>${esc(n)}</li>`).join('')}</ul>`:''}<ul>${p.placement.map(x=>`<li>${esc(x.label)}${x.active?'':' (inactive)'} · ${esc(x.place)}</li>`).join('')}</ul>${p.notes.map(n=>`<p class="muted">${esc(n)}</p>`).join('')}`,p.switchRequired?'Switch to v2 and add places':'Add places');
  if(!ok)return;await api('/branches/'+key+'/locations',{expected:rec.branch.head,places:names,at,switchAssembly:p.switchRequired});$('#panel').dataset.key='';await refresh();
}
