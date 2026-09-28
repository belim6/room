/* Revise a reply: feedback → candidate → judgment → optional replacement and training approval. Each step is a separate record. */
let reviewPage=null,reviewTimer,reviewPending=new Set();
async function openReview(key,messageId){
  const d=await api('/branches/'+key+'/reviews',{message:messageId});
  reviewPage={key,data:d};focusPane(key,'revise',messageId);
}
async function reloadReview(){
  if(!reviewPage)return;const d=await api('/reviews/'+reviewPage.data.review.id);
  if(reviewPage?.data.review.id!==d.review.id)return;reviewPage.data=d;if(tab==='revise')renderPanel();
}
function renderReview(panel){
  clearTimeout(reviewTimer);
  if(!reviewPage||reviewPage.key!==current){panel.innerHTML='<h2>Revise a reply</h2><p class="muted">Use Revise under a generated reply.</p>';return;}
  const {review,candidates,approval,source}=reviewPage.data,key=reviewPage.key,state=records.get(key)?.branch.revision.state;
  const index=state?state.messages.findIndex(m=>m.id===review.message.id||m.review===review.id):-1,live=index>=0?state.messages[index]:null,later=index>=0?state.messages.length-index-1:0;
  const drafts=Object.fromEntries([...panel.querySelectorAll('[data-candidate-text]')].map(t=>[t.dataset.candidateText,t.value])),notes=Object.fromEntries([...panel.querySelectorAll('[data-candidate-note]')].map(t=>[t.dataset.candidateNote,t.value])),feedback=panel.querySelector('#review-feedback')?.value||'';
  const busy=reviewPending.has(review.id)||candidates.some(c=>c.active);
  const card=c=>{
    const j=c.judgment,done=c.result?.status==='completed',accepted=j?.verdict==='accepted',applied=live?.review===review.id&&live.turnId===c.turnId,approved=approval?.current&&approval.candidate===c.id;
    return `<article class="review-candidate"><p class="muted">Feedback · ${esc(new Date(c.at).toLocaleString())}</p><blockquote>${esc(c.feedback)}</blockquote>
      ${c.active?`<p>Generating… <button data-stop-candidate="${c.id}">Stop</button></p>`:!c.result?'<p class="muted">Pending</p>':!done?`<p class="notice">${esc(c.result.status)}: ${esc(c.result.error||'')}</p>`:`
      <label>Candidate reply${j?` · ${j.verdict}`:''}<textarea data-candidate-text="${c.id}" rows="6">${esc(drafts[c.id]??j?.text??c.result.text)}</textarea></label>
      ${j&&j.text!==c.result.text?`<details><summary>As generated</summary><p>${esc(c.result.text)}</p></details>`:''}
      <label>Note (optional)<textarea data-candidate-note="${c.id}" rows="2">${esc(notes[c.id]??j?.note??'')}</textarea></label>
      <div class="review-actions"><button data-judge="${c.id}" data-verdict="accepted" class="${accepted?'primary':''}">${accepted?'Accepted · save edits':'Accept'}</button><button data-judge="${c.id}" data-verdict="rejected">${j?.verdict==='rejected'?'Rejected':'Reject'}</button></div>
      ${accepted?`<div class="review-actions"><button data-apply="${c.id}" ${applied||!live?'disabled':''}>${applied?'In the conversation':'Replace in conversation'}</button>${!live?'<small>The reply is no longer in this conversation.</small>':later&&!applied?`<small>${later} later message${later===1?'':'s'} responded to the original and stay as they are.</small>`:''}</div>
      <fieldset class="training"><legend>Training</legend><label><input type="checkbox" data-approve="${c.id}" ${approved?'checked':''}> Approve as a training example (original input → this reply)</label><label><input type="checkbox" data-preference="${c.id}" ${approved&&approval.preference?'checked':''}> Also keep the original as the rejected reply (preference pair)</label><button data-curate="${c.id}">Save training decision</button>${approved?'<small>Approved.</small>':''}</fieldset>`:''}`}</article>`;
  };
  panel.innerHTML=`<h2>Revise a reply</h2><p class="muted">${esc(review.message.speaker)} · ${esc(source.provider)} · ${esc(source.model)}</p>
    <details open><summary>Original reply</summary><p>${esc(review.message.text)}</p></details>
    ${live&&live.id!==review.message.id?`<p class="notice">The conversation now shows a replacement. The original stays in earlier revisions and in this review.</p>`:''}
    <label for="review-feedback">Your feedback</label><textarea id="review-feedback" rows="3" placeholder="What should change? e.g. Don't invent having seen calendars. Keep the point grounded.">${esc(feedback)}</textarea>
    <button id="propose-candidate" class="primary wide" ${busy?'disabled':''}>Generate alternative</button>
    <p class="muted">One request to ${esc(source.provider)} / ${esc(source.model)}: the original request, unchanged, plus your feedback and the original reply as a final instruction. Nothing in the conversation changes until you accept a candidate and choose Replace. Feedback never enters later turns.</p>
    ${[...candidates].reverse().map(card).join('')}
    <div class="divider"></div><p class="muted">Approved examples: <a href="/api/dataset/sft">export SFT (JSONL)</a> · <a href="/api/dataset/preference">export preference pairs (JSONL)</a>. Each uses the original input, without your feedback.</p>`;
  const judgedId=c=>c.judgment?.id||null;
  $('#propose-candidate').onclick=action(async()=>{
    const text=$('#review-feedback').value;if(!text.trim())throw Error('Write feedback first');
    const id=review.id;reviewPending.add(id);renderPanel();
    const done=api('/reviews/'+id+'/candidates',{feedback:text}).finally(()=>reviewPending.delete(id));
    reviewTimer=setTimeout(()=>reloadReview().catch(error),600);
    await done;$('#review-feedback')&&($('#review-feedback').value='');await reloadReview();
  });
  panel.querySelectorAll('[data-stop-candidate]').forEach(b=>b.onclick=action(async()=>{await api('/candidates/'+b.dataset.stopCandidate+'/stop',{});await reloadReview();}));
  panel.querySelectorAll('[data-judge]').forEach(b=>b.onclick=action(async()=>{const c=candidates.find(c=>c.id===b.dataset.judge);reviewPage.data=await api('/candidates/'+c.id+'/judge',{expected:judgedId(c),verdict:b.dataset.verdict,text:panel.querySelector(`[data-candidate-text="${c.id}"]`).value,note:panel.querySelector(`[data-candidate-note="${c.id}"]`).value});renderPanel();}));
  panel.querySelectorAll('[data-apply]').forEach(b=>b.onclick=action(async()=>{const c=candidates.find(c=>c.id===b.dataset.apply);if(isBusy(key))throw Error('Stop generation before replacing a reply');await api('/candidates/'+c.id+'/apply',{judgment:c.judgment.id,expected:records.get(key).branch.head});await refresh();await reloadReview();}));
  panel.querySelectorAll('[data-curate]').forEach(b=>b.onclick=action(async()=>{const c=candidates.find(c=>c.id===b.dataset.curate),approved=panel.querySelector(`[data-approve="${c.id}"]`).checked;reviewPage.data=await api('/reviews/'+review.id+'/training',{expected:approval?.id||null,candidate:c.id,judgment:judgedId(c),approved,preference:approved&&panel.querySelector(`[data-preference="${c.id}"]`).checked});renderPanel();}));
  if(busy)reviewTimer=setTimeout(()=>reloadReview().catch(error),1200);
}
