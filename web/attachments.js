const attachmentUploads=new Set(),messageSends=new Set();
function attachmentBusy(key){return attachmentUploads.has(key)||messageSends.has(key);}
function fileSize(size){return size>=1024*1024?(size/1024/1024).toFixed(1)+' MB':Math.max(1,Math.round(size/1024))+' KB';}
function fileCard(a,removeFrom){
  const src='/api/attachments/'+encodeURIComponent(a.id)+'/file';
  return `<div class="attachment-card">${a.kind==='image'?`<a href="${src}?inline=1" target="_blank" rel="noopener"><img src="${src}?inline=1" alt="${esc(a.name)}" loading="lazy"></a>`:'<span class="document-icon" aria-hidden="true">▤</span>'}<div><strong>${esc(a.name)}</strong><small>${esc(fileSize(a.size))} · ${a.kind==='image'?'Image input · vision model required':esc((a.textLength||0).toLocaleString())+' characters · extracted text'}</small><a href="${src}" download>Download</a>${a.kind==='document'?` <button type="button" data-attachment-text="${esc(a.id)}">Read extracted text</button>`:''}${removeFrom?` <button type="button" data-remove-attachment="${esc(a.id)}" data-owner="${esc(removeFrom)}" aria-label="Remove ${esc(a.name)}">Remove</button>`:''}</div></div>`;
}
function messageAttachments(message,key){
  const attachments=records.get(key)?.attachments||[];
  return (message.attachments||[]).map(id=>{const a=attachments.find(a=>a.id===id);return a?fileCard(a):'<p class="notice">Attachment unavailable.</p>';}).join('');
}
function attachmentComposer(key){
  const draft=drafts.get(key)||{},caps=boot.attachments||{},busy=attachmentBusy(key)||isBusy(key);
  return `<div class="attachment-tools"><label class="attach-button">＋ Attach<input data-attach="${key}" type="file" multiple accept="${esc(caps.accept||'')}" ${busy?'disabled':''}></label><span class="muted">${attachmentUploads.has(key)?'Uploading and reading files…':messageSends.has(key)?'Sending…':'Drop files or paste an image · up to '+(caps.maxFiles||4)+' files, 10 MB each'}</span></div><div class="draft-attachments" aria-live="polite">${(draft.attachments||[]).map(a=>fileCard(a,key)).join('')}</div>${draft.attachments?.length?'<p class="attachment-hint">Files stay local until Continue. Documents send extracted text; embedded document images and layout are not included. Images require a vision-capable model.</p>':''}`;
}
async function addAttachments(key,files){
  if(attachmentBusy(key))throw Error('Wait for the current upload or send to finish');
  if(!files.length)return;
  const currentFiles=drafts.get(key)?.attachments||[],caps=boot.attachments;
  if(currentFiles.length+files.length>caps.maxFiles)throw Error(`Attach up to ${caps.maxFiles} files per message`);
  if(files.some(f=>!f.size||f.size>caps.maxBytes))throw Error('Choose non-empty files up to 10 MB each');
  rememberInputs();attachmentUploads.add(key);render();
  try {
    for(const file of files){
      const r=await fetch('/api/attachments',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Room-Filename':encodeURIComponent(file.name)},body:file});
      const value=await r.json();if(!r.ok)throw Error(value.error||'Upload failed');
      const draft=drafts.get(key)||{};drafts.set(key,{...draft,attachments:[...(draft.attachments||[]),value]});
    }
  }finally{attachmentUploads.delete(key);render();}
}
async function sendRoomMessage(form){
  const key=form.dataset.compose;if(attachmentBusy(key))throw Error('Wait for the current upload or send to finish');
  rememberInputs();const draft=drafts.get(key)||{},snapshot=records.get(key),text=draft.text||'',attachments=(draft.attachments||[]).map(a=>a.id);
  if(!text.trim()&&!attachments.length)throw Error('Write a message or attach a file');
  messageSends.add(key);render();
  try {
    await api('/branches/'+key+'/messages',{expected:snapshot.branch.head,text,attachments});
    // Clear only this pane's draft after a successful commit; failed sends keep all files.
    drafts.set(key,{...drafts.get(key),text:'',attachments:[]});
    const input=document.querySelector(`[data-controls="${key}"] [data-text]`);if(input)input.value='';
    await refresh();scrollMessages(key);
  }finally{messageSends.delete(key);render();}
}
function bindAttachmentControls(){
  document.querySelectorAll('[data-attach]').forEach(input=>input.onchange=action(()=>addAttachments(input.dataset.attach,[...input.files])));
  document.querySelectorAll('[data-remove-attachment]').forEach(button=>button.onclick=action(()=>{const key=button.dataset.owner;if(attachmentBusy(key))throw Error('Wait for the upload or send to finish');rememberInputs();const draft=drafts.get(key)||{};drafts.set(key,{...draft,attachments:(draft.attachments||[]).filter(a=>a.id!==button.dataset.removeAttachment)});render();}));
  bindAttachmentReaders();
  document.querySelectorAll('[data-controls]').forEach(area=>{
    area.ondragover=event=>{if([...event.dataTransfer.types].includes('Files')){event.preventDefault();area.classList.add('file-drag');}};
    area.ondragleave=()=>area.classList.remove('file-drag');
    area.ondrop=action(async event=>{event.preventDefault();area.classList.remove('file-drag');await addAttachments(area.dataset.controls,[...event.dataTransfer.files]);});
    const text=area.querySelector('[data-text]');if(text)text.onpaste=action(async event=>{const files=[...event.clipboardData.items].filter(i=>i.kind==='file').map(i=>i.getAsFile()).filter(Boolean);if(files.length){event.preventDefault();await addAttachments(area.dataset.controls,files);}});
  });
}
function bindAttachmentReaders(){
  document.querySelectorAll('[data-attachment-text]').forEach(button=>button.onclick=action(async()=>{const file=await api('/attachments/'+button.dataset.attachmentText);await dialog(file.name,`<p class="muted">${esc(file.extraction)}. This exact extracted text is included in future character requests while the message remains in context.</p><pre class="attachment-text">${esc(file.text)}</pre>`,'Close');}));
}
