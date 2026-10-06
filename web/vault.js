/* Vault: reusable persona material with no names. Components → personas → room templates. Nothing here calls a model. */
let vaultPage=null;
const VAULT_TYPES={component:'Component',persona:'Persona','room-template':'Room template'};
function leaveVault(){if(!vaultPage)return;vaultPage=null;$('#panel').dataset.key='';document.querySelector('.workspace').classList.remove('experiment-mode');$('#vault-page').hidden=true;}
async function loadVault(){const v=await api('/vault');vaultPage.items=v.items;vaultPage.kinds=v.kinds;vaultPage.detail=vaultPage.open&&!vaultPage.open.startsWith('new:')?await api('/vault/'+vaultPage.open):null;}
async function openVault(open=null){
  if(experimentPage)leaveExperiment();comparison=null;localStorage.removeItem('room-comparison');
  vaultPage={filter:vaultPage?.filter||{type:'',kind:'',tag:'',archived:false,text:''},open,draft:null,diff:null,items:[],kinds:[]};category='vault';
  await loadVault();render();
}
async function openVaultItem(key){vaultPage.open=key;vaultPage.draft=null;vaultPage.diff=null;await loadVault();render();$('#vault-page').scrollTop=0;}
const vaultItem=key=>vaultPage.items.find(i=>i.id===key);
const kindName=key=>vaultPage.kinds.find(k=>k.id===key)?.name||'unknown kind';
function vaultLibrary(){
  const items=vaultPage?.items||boot.vault?.items||[],count=t=>items.filter(i=>i.type===t&&!i.archived).length;
  $('#branches').innerHTML=Object.entries(VAULT_TYPES).map(([t,label])=>`<button data-vault-type="${t}" class="${vaultPage&&vaultPage.filter.type===t&&!vaultPage.open?'active':''}">${label}s<small>${count(t)} active</small></button>`).join('')+`<button data-vault-type="" class="${vaultPage&&!vaultPage.filter.type&&!vaultPage.open?'active':''}">Everything<small>Components, personas and templates have no names; labels are given in rooms.</small></button>`;
  document.querySelectorAll('[data-vault-type]').forEach(b=>b.onclick=action(async()=>{if(!vaultPage)await openVault();vaultPage.filter.type=b.dataset.vaultType;vaultPage.open=null;vaultPage.detail=null;render();}));
}
function vaultSummary(i){
  const c=i.current.content;
  if(i.type==='component')return `${c.kind?`<span class="outcome-tag">${esc(kindName(c.kind))}</span>`:''}${(c.tags||[]).map(t=>`<span class="outcome-tag tag-secondary">${esc(kindName(t))}</span>`).join('')}<p>${esc(c.text.slice(0,220))}${c.text.length>220?'…':''}</p>`;
  if(i.type==='persona')return `<p class="muted">${c.components.length} component${c.components.length===1?'':'s'}${c.extra.trim()?' + extra text':''}</p><p>${esc(c.compiled.slice(0,220))||'<span class="muted">Empty persona</span>'}${c.compiled.length>220?'…':''}</p>`;
  return `<p class="muted">${c.cast.length} people · flow ${esc(c.flow)}${c.opening?' · '+esc(c.opening.kind)+' opening':''}</p><p>${esc(c.cast.map(x=>x.label).join(', '))}</p>`;
}
function renderVault(){
  const v=vaultPage,page=$('#vault-page'),f=v.filter;
  document.querySelector('.workspace').classList.add('experiment-mode');
  $('#messages').hidden=true;$('#comparison').hidden=true;$('#experiment-page').hidden=true;document.querySelector('main > footer').hidden=true;page.hidden=false;
  $('#title').textContent='Vault';$('#subtitle').textContent='Reusable material without names. Revising here changes nothing in a room until you adopt it there.';
  $('#family-nav').innerHTML='';$('#title-changes').hidden=true;
  if(v.open){page.innerHTML=vaultDetailHtml();bindVaultDetail();return;}
  const terms=f.text.toLocaleLowerCase().trim();
  const items=v.items.filter(i=>(!f.type||i.type===f.type)&&(f.archived||!i.archived)&&(!f.kind||i.current.content.kind===f.kind)&&(!f.tag||(i.current.content.tags||[]).includes(f.tag))&&(!terms||(i.title+' '+(i.current.content.text||i.current.content.compiled||'')).toLocaleLowerCase().includes(terms)));
  const kindOptions=sel=>v.kinds.map(k=>`<option value="${esc(k.id)}" ${k.id===sel?'selected':''}>${esc(k.name)}${k.archived?' (archived)':''}</option>`).join('');
  page.innerHTML=`<div class="experiment-actions">${Object.entries(VAULT_TYPES).map(([t,l])=>`<button data-new-vault="${t}" class="${t==='component'?'primary':''}">＋ ${l}</button>`).join('')}<button id="vault-kinds">Manage kinds</button></div>
    <div class="trial-filters"><label>Type <select id="vault-type"><option value="">All types</option>${Object.entries(VAULT_TYPES).map(([t,l])=>`<option value="${t}" ${t===f.type?'selected':''}>${l}s</option>`).join('')}</select></label><label>Kind <select id="vault-kind"><option value="">Any kind</option>${kindOptions(f.kind)}</select></label><label>Tag <select id="vault-tag"><option value="">Any tag</option>${kindOptions(f.tag)}</select></label><label>Search <input id="vault-search" type="search" value="${esc(f.text)}" placeholder="Title or text"></label><label class="inline-check"><input id="vault-archived" type="checkbox" ${f.archived?'checked':''}> Show archived</label></div>
    <p class="muted">${items.length} of ${v.items.length} items. Kinds and tags are for browsing only; they never change how a persona compiles.</p>
    <div class="condition-grid">${items.map(i=>`<article class="condition-card vault-card"><h3><button class="link-button" data-open-vault="${i.id}">${esc(i.title)}</button> <span class="badge">${esc(VAULT_TYPES[i.type])}</span>${i.archived?' <span class="badge">archived</span>':''}</h3>${vaultSummary(i)}</article>`).join('')||'<p class="muted">The vault is empty. Start with a component: one portable piece of a person.</p>'}</div>`;
  for(const [id,key] of [['#vault-type','type'],['#vault-kind','kind'],['#vault-tag','tag']])$(id).onchange=ev=>{f[key]=ev.target.value;render();};
  $('#vault-archived').onchange=ev=>{f.archived=ev.target.checked;render();};
  $('#vault-search').oninput=ev=>{f.text=ev.target.value;const pos=ev.target.selectionStart;render();const s=$('#vault-search');s.focus();s.setSelectionRange(pos,pos);};
  page.querySelectorAll('[data-open-vault]').forEach(b=>b.onclick=action(()=>openVaultItem(b.dataset.openVault)));
  page.querySelectorAll('[data-new-vault]').forEach(b=>b.onclick=action(()=>openVaultItem('new:'+b.dataset.newVault)));
  $('#vault-kinds').onclick=action(manageKinds);
}
const BLANK={component:{text:''},persona:{components:[],extra:''},'room-template':{system:'',flow:'random',cast:[]}};
function vaultDraft(){
  const v=vaultPage;if(v.draft)return v.draft;
  const type=v.open.startsWith('new:')?v.open.slice(4):v.detail.item.type,content=structuredClone(v.open.startsWith('new:')?BLANK[type]:v.detail.current.content);
  if(type==='persona')delete content.compiled;
  return v.draft={type,title:v.open.startsWith('new:')?'':v.detail.item.title,content,note:'',compiled:v.detail?.current.content.compiled??''};
}
function headOf(key){return vaultItem(key)?.head;}
function refRow(r,i,kind){const it=vaultItem(r.item),latest=it&&it.head===r.revision;return `<div class="ref-row"><span><strong>${esc(it?.title||'Missing item')}</strong>${it?.archived?' <span class="badge">archived</span>':''}<small>revision ${esc(r.revision.slice(0,8))} · ${latest?'latest':'<button type="button" class="link-button" data-ref-latest="'+i+'">newer revision available · use it</button>'}</small></span><span>${kind==='component'?`<button type="button" data-ref-move="${i}" data-dir="-1" aria-label="Move up">↑</button><button type="button" data-ref-move="${i}" data-dir="1" aria-label="Move down">↓</button>`:''}<button type="button" data-ref-remove="${i}">Remove</button></span></div>`;}
function vaultEditorHtml(d){
  // Linked examples (tension/contradiction) first: components that connect elements, not lists of adjectives.
  const c=d.content,kinds=vaultPage.kinds,examples=[...kinds].sort((a,b)=>(b.name.includes('tension')?1:0)-(a.name.includes('tension')?1:0)).flatMap(k=>k.examples.map(e=>({k:k.name,e}))).slice(0,6);
  if(d.type==='component')return `<label>Text<textarea id="vault-text" rows="8" placeholder="One portable piece of a person. Link elements rather than listing adjectives.">${esc(c.text)}</textarea></label>
    <p class="muted">Examples: ${examples.map(x=>`<em>${esc(x.e)}</em> (${esc(x.k)})`).join(' · ')}</p>
    <label>Kind (optional)<select id="vault-component-kind"><option value="">No kind</option>${kinds.map(k=>`<option value="${esc(k.id)}" ${k.id===c.kind?'selected':''}>${esc(k.name)}${k.archived?' (archived)':''}</option>`).join('')}</select></label>
    <fieldset class="vault-tags"><legend>Tags: other kinds this spans</legend>${kinds.map(k=>`<label><input type="checkbox" data-vault-tag="${esc(k.id)}" ${(c.tags||[]).includes(k.id)?'checked':''}> ${esc(k.name)}</label>`).join('')}</fieldset>
    <p class="muted">A want for one evening or one relationship belongs in a person's situation in the room, not here.</p>`;
  if(d.type==='persona'){const comps=vaultPage.items.filter(i=>i.type==='component');return `<h3>Components, in compile order</h3><div id="ref-rows">${c.components.map((r,i)=>refRow(r,i,'component')).join('')||'<p class="muted">No components yet. A persona with none is valid.</p>'}</div>
    <label>Add component<select id="vault-add-ref"><option value="">Choose…</option>${comps.map(i=>`<option value="${i.id}">${esc(i.title)}${i.archived?' (archived)':''}</option>`).join('')}</select></label>
    <label>Extra text (appended last)<textarea id="vault-extra" rows="4">${esc(c.extra)}</textarea></label>
    <h3>Compiled preview</h3><pre id="vault-compiled" class="compiled">${esc(d.compiled)||'<span class="muted">(empty)</span>'}</pre><p class="muted">Compiler v1: each component trimmed, blanks skipped, then the extra text, joined by one blank line. No headers, kind labels or names.</p>`;}
  const personas=vaultPage.items.filter(i=>i.type==='persona'),fr=c.frame;
  return `<label>Room instructions<textarea id="vault-system" rows="6">${esc(c.system)}</textarea></label>
    <label>Flow<select id="vault-flow"><option value="random">Random speaker</option><option value="alternate" ${c.flow==='alternate'?'selected':''}>Back-and-forth (needs exactly two people)</option></select></label>
    <details ${fr?'open':''}><summary>Harness framing ${fr?'· set':'· not set (rooms use transcript-only framing)'}</summary><label class="inline-check"><input type="checkbox" id="vault-frame-on" ${fr?'checked':''}> Include framing</label>${['identity','context','opening','turn'].map(k=>`<label>${k}<textarea data-vault-frame="${k}" rows="2">${esc(fr?.[k]??boot.frame[k])}</textarea></label>`).join('')}</details>
    <label>Opening (inserted once, when a room is created)<select id="vault-opening-kind"><option value="">No opening</option><option value="narrator" ${c.opening?.kind==='narrator'?'selected':''}>Narrator</option><option value="human" ${c.opening?.kind==='human'?'selected':''}>You</option></select></label><textarea id="vault-opening-text" rows="3">${esc(c.opening?.text||'')}</textarea>
    <h3>Cast</h3><div id="cast-rows">${c.cast.map((x,i)=>`<div class="cast-row">${refRow(x.persona,i,'persona')}<label>Label in the room<input data-cast-label="${i}" value="${esc(x.label)}" maxlength="80"></label><label>Situation (this room only)<textarea data-cast-situation="${i}" rows="2">${esc(x.situation||'')}</textarea></label></div>`).join('')||'<p class="muted">No people yet.</p>'}</div>
    <label>Add person from persona<select id="vault-add-cast"><option value="">Choose…</option>${personas.map(i=>`<option value="${i.id}">${esc(i.title)}${i.archived?' (archived)':''}</option>`).join('')}</select></label>`;
}
function readVaultForm(){
  const d=vaultDraft(),c=d.content;d.title=$('#vault-title').value;d.note=$('#vault-note').value;
  if(d.type==='component'){c.text=$('#vault-text').value;const k=$('#vault-component-kind').value;if(k)c.kind=k;else delete c.kind;const tags=[...document.querySelectorAll('[data-vault-tag]:checked')].map(t=>t.dataset.vaultTag);if(tags.length)c.tags=tags;else delete c.tags;}
  if(d.type==='persona')c.extra=$('#vault-extra').value;
  if(d.type==='room-template'){c.system=$('#vault-system').value;c.flow=$('#vault-flow').value;
    if($('#vault-frame-on').checked)c.frame=Object.fromEntries([...document.querySelectorAll('[data-vault-frame]')].map(t=>[t.dataset.vaultFrame,t.value]));else delete c.frame;
    const kind=$('#vault-opening-kind').value;if(kind)c.opening={kind,text:$('#vault-opening-text').value};else delete c.opening;
    c.cast.forEach((x,i)=>{x.label=document.querySelector(`[data-cast-label="${i}"]`).value;const s=document.querySelector(`[data-cast-situation="${i}"]`).value;if(s)x.situation=s;else delete x.situation;});}
  return d;
}
async function refreshCompiled(){const d=vaultDraft();if(d.type!=='persona')return;try{d.compiled=(await api('/vault/compile',{type:'persona',content:d.content})).compiled;}catch(e){d.compiled='';error(e);}const el=$('#vault-compiled');if(el)el.textContent=d.compiled||'(empty)';}
function vaultDetailHtml(){
  const v=vaultPage,d=vaultDraft(),detail=v.detail,isNew=v.open.startsWith('new:');
  const history=detail?[...detail.revisions].reverse().map((r,i,all)=>`<li><strong>${esc(new Date(r.at).toLocaleString())}</strong> · ${esc(r.author)}${r.note?' · '+esc(r.note):''} <code>${esc(r.id.slice(0,8))}</code>${r.id===detail.item.head?' <span class="badge">head</span>':''}${all[i+1]?` <button type="button" class="link-button" data-vault-diff="${r.id}" data-from="${all[i+1].id}">diff with previous</button>`:''}</li>`).join(''):'';
  const updates=detail?.updates?.length?`<p class="notice">Newer revisions exist for: ${detail.updates.map(u=>esc(u.title)).join(', ')}. Use “use it” on a row, check the preview, then save to adopt them into this ${esc(VAULT_TYPES[detail.item.type].toLowerCase())}.</p>`:'';
  return `<p><button class="link-button" id="vault-back">← All vault items</button></p><h2>${isNew?'New '+esc(VAULT_TYPES[d.type].toLowerCase()):esc(detail.item.title)} ${detail?.item.archived?'<span class="badge">archived</span>':''}</h2>${updates}
    <form id="vault-form" class="vault-form"><label>Working title (never sent to a model)<input id="vault-title" value="${esc(d.title)}" required maxlength="120"></label>${vaultEditorHtml(d)}<label>Revision note (optional)<input id="vault-note" value="${esc(d.note)}"></label>
    <div class="experiment-actions"><button class="primary" type="submit">${isNew?'Create':'Save as new revision'}</button>${detail?`<button type="button" id="vault-archive">${detail.item.archived?'Restore from archive':'Archive'}</button>`:''}</div></form>
    ${detail?`<h2>Revision history</h2><ol class="vault-history">${history}</ol><div id="vault-diff">${v.diff?`<h3>Text</h3>${RoomChanges.diff(v.diff.text)}<details><summary>Full structure</summary>${RoomChanges.diff(v.diff.structure)}</details>`:''}</div>`:''}`;
}
function bindVaultDetail(){
  const v=vaultPage,d=vaultDraft(),rerender=()=>{readVaultForm();render();};
  $('#vault-back').onclick=action(async()=>{v.open=null;v.draft=null;await loadVault();render();});
  $('#vault-form').onsubmit=action(async ev=>{ev.preventDefault();const x=readVaultForm(),body={title:x.title,content:x.content,note:x.note};
    const result=v.open.startsWith('new:')?await api('/vault',{type:x.type,...body}):await api('/vault/'+v.detail.item.id+'/revise',{...body,expected:v.detail.item.head});
    v.open=result.item.id;v.draft=null;v.diff=null;await loadVault();render();});
  $('#vault-archive')?.addEventListener('click',action(async()=>{await api('/vault/'+v.detail.item.id+'/archive',{expected:v.detail.item.head,archived:!v.detail.item.archived});v.draft=null;await loadVault();render();}));
  document.querySelectorAll('[data-vault-diff]').forEach(b=>b.onclick=action(async()=>{v.diff=await api(`/vault/${v.detail.item.id}/diff?from=${encodeURIComponent(b.dataset.from)}&to=${encodeURIComponent(b.dataset.vaultDiff)}`);readVaultForm();render();}));
  const refs=()=>d.type==='persona'?d.content.components:d.content.cast.map(x=>x.persona);
  document.querySelectorAll('[data-ref-latest]').forEach(b=>b.onclick=action(async()=>{readVaultForm();const r=refs()[b.dataset.refLatest];r.revision=headOf(r.item);await refreshCompiled();render();}));
  document.querySelectorAll('[data-ref-remove]').forEach(b=>b.onclick=action(async()=>{readVaultForm();(d.type==='persona'?d.content.components:d.content.cast).splice(Number(b.dataset.refRemove),1);await refreshCompiled();render();}));
  document.querySelectorAll('[data-ref-move]').forEach(b=>b.onclick=action(async()=>{readVaultForm();const list=d.content.components,i=Number(b.dataset.refMove),j=i+Number(b.dataset.dir);if(j<0||j>=list.length)return;[list[i],list[j]]=[list[j],list[i]];await refreshCompiled();render();}));
  $('#vault-add-ref')?.addEventListener('change',action(async ev=>{if(!ev.target.value)return;readVaultForm();d.content.components.push({item:ev.target.value,revision:headOf(ev.target.value)});await refreshCompiled();render();}));
  $('#vault-add-cast')?.addEventListener('change',ev=>{if(!ev.target.value)return;readVaultForm();d.content.cast.push({persona:{item:ev.target.value,revision:headOf(ev.target.value)},label:''});render();});
  $('#vault-extra')?.addEventListener('input',()=>{clearTimeout(v.compileTimer);v.compileTimer=setTimeout(()=>{readVaultForm();refreshCompiled();},300);});
  void rerender;
}
async function manageKinds(){
  const kinds=vaultPage.kinds;
  const f=await dialog('Component kinds',`<p class="muted">Kinds are browsing categories, stored as data. Renaming keeps a kind's identity, so references survive. They never change how a persona compiles.</p>${kinds.map(k=>`<fieldset class="kind-row"><label>Name<input name="name-${k.id}" value="${esc(k.name)}" required></label><label>Description<textarea name="description-${k.id}" rows="2">${esc(k.description)}</textarea></label><label>Examples (one per line)<textarea name="examples-${k.id}" rows="2">${esc(k.examples.join('\n'))}</textarea></label><label class="inline-check"><input type="checkbox" name="archived-${k.id}" ${k.archived?'checked':''}> Archived</label></fieldset>`).join('')}<fieldset class="kind-row"><legend>New kind</legend><label>Name<input name="new-name"></label><label>Description<textarea name="new-description" rows="2"></textarea></label></fieldset>`,'Save kinds');
  if(!f)return;
  for(const k of kinds){
    const name=f.get('name-'+k.id),description=f.get('description-'+k.id),examples=f.get('examples-'+k.id).split('\n').map(x=>x.trim()).filter(Boolean),archived=f.get('archived-'+k.id)==='on';
    let head=k.head;
    if(name!==k.name||description!==k.description||JSON.stringify(examples)!==JSON.stringify(k.examples))head=(await api('/vault-kinds/'+k.id+'/revise',{expected:k.head,name,description,examples})).head;
    if(archived!==k.archived)await api('/vault-kinds/'+k.id+'/archive',{expected:head,archived});
  }
  if(f.get('new-name').trim())await api('/vault-kinds',{name:f.get('new-name'),description:f.get('new-description'),examples:[]});
  await loadVault();render();
}
