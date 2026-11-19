const {L,setup,j}=require('./common.cjs');
(async()=>{ const {browser,ctxs}=await setup(); for(const [n,c] of Object.entries(L.ENV.channels)){ const api=`${L.BASE}/dss/messages/channel/${c}`;
 let cursor=null; const types={},kinds={}; let total=0; let acts=[];
 for(let p=0;p<10;p++){ const sel={limit:100,direction:'older',around:null,include_deleted_threads:false}; if(cursor)sel.cursor=cursor; const r=await j(await ctxs.alice.request.get(`${api}/timeline?selection=${encodeURIComponent(JSON.stringify(sel))}`)); if(r.status!==200){console.log(n,r.status);break;}
  for(const e of r.body.entries){types[e.type]=(types[e.type]||0)+1; if(e.message)kinds[e.message.kind]=(kinds[e.message.kind]||0)+1; else if(acts.length<2)acts.push(JSON.stringify(e).slice(0,250));} cursor=r.body.next_cursor; if(!cursor)break; }
 console.log(n,JSON.stringify(types),JSON.stringify(kinds),acts.join(' ')); }
 await browser.close();})();
