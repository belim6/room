/* Pure family helpers for experiments and saved comparisons: roots in the sidebar, tree order in the navigator. */
const RoomFamilies=(()=>{
  function tree(items,parentOf,key){
    const byId=new Map(items.map(i=>[i.id,i])),up=i=>byId.get(parentOf(i));
    let root=byId.get(key);const seen=new Set();while(root&&up(root)&&!seen.has(root.id)){seen.add(root.id);root=up(root);}
    if(!root)return [];
    const out=[],visit=(i,depth)=>{if(out.some(o=>o.item.id===i.id))return;out.push({item:i,depth});items.filter(c=>parentOf(c)===i.id).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)).forEach(c=>visit(c,depth+1));};
    visit(root,0);return out;
  }
  function roots(items,parentOf){const ids=new Set(items.map(i=>i.id));return items.filter(i=>!parentOf(i)||!ids.has(parentOf(i)));}
  return {tree,roots};
})();
if(typeof module!=='undefined')module.exports=RoomFamilies;
