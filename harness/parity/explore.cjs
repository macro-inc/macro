const {L,setup,j,DIR}=require('./common.cjs'); const fs=require('fs');
(async()=>{
 const {browser,ctxs}=await setup(['alice@seed.macro.local']);
 const api=`${L.BASE}/dss/messages/channel/${L.ENV.channels.large}`;
 let cursor=null; const all=[];
 for(let p=0;p<130;p++){
  const sel={limit:50,direction:'older',around:null,include_deleted_threads:false}; if(cursor) sel.cursor=cursor;
  const r=await j(await ctxs.alice.request.get(`${api}/timeline?selection=${encodeURIComponent(JSON.stringify(sel))}`));
  if(r.status!==200){console.log(p,r.status,JSON.stringify(r.body).slice(0,200));break;}
  all.push(...r.body.entries); cursor=r.body.next_cursor; if(!cursor)break;
 }
 console.log(all.length);
 fs.writeFileSync(DIR+'/large-all.json',JSON.stringify(all));
 const roots=all.filter(e=>e.type!=='activity').map(e=>e.message);
 const withReplies=roots.filter(m=>m.thread&&m.thread.reply_count>0).map(m=>({id:m.id,n:m.thread.reply_count,idx:roots.indexOf(m)}));
 console.log(roots.length,'activity',all.length-roots.length, JSON.stringify(withReplies.slice(0,40)));
 console.log('kinds',[...new Set(roots.map(m=>m.kind))], 'idx3000', roots[3000]&&roots[3000].id, roots[3000]&&roots[3000].created_at);
 await browser.close();
})();
