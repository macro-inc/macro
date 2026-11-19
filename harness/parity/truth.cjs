const {L,setup,j,DIR}=require('./common.cjs'); const fs=require('fs');
(async()=>{
 const {browser,ctxs}=await setup(); const api=`${L.BASE}/dss/messages/channel/${L.ENV.channels.large}`;
 let cursor=null; const ids=[];
 for(let p=0;p<500;p++){ const sel={limit:100,direction:'older',around:null,include_deleted_threads:false}; if(cursor)sel.cursor=cursor;
  const r=await j(await ctxs.alice.request.get(`${api}/timeline?selection=${encodeURIComponent(JSON.stringify(sel))}`)); if(r.status!==200){console.log(r.status);break;}
  for(const e of r.body.entries) ids.push(e.message.id); cursor=r.body.next_cursor; if(!cursor)break; }
 fs.writeFileSync(DIR+'/large-ids.json',JSON.stringify(ids)); console.log(ids.length); await browser.close();})();
