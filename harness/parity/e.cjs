const {L,setup,j,openPage,DIR,dumpIssues}=require('./common.cjs'); const fs=require('fs'); const E=L.ENV.channels; const out={};
(async()=>{ const {browser,ctxs}=await setup(['alice@seed.macro.local','bob@seed.macro.local']);
 const truth={}; const names={small:'perf-small',medium:'perf-medium',large:'perf-large',lobby:'lobby',freshness:'freshness'};
 for(const k of Object.keys(names)){ const api=`${L.BASE}/dss/messages/channel/${E[k]}`; const r=await j(await ctxs.bob.request.get(`${api}/timeline?selection=${encodeURIComponent(JSON.stringify({limit:100,direction:'older',around:null,include_deleted_threads:false}))}`));
   truth[k]=r.body.entries.map(e=>({id:e.message.id,c:(e.message.content||'').replace(/<[^>]+>/g,'').slice(0,30),del:!!e.message.deleted_at})); }
 // E1 reload parity on channels alice opened before
 out.reload={};
 for(const k of ['freshness','lobby','small']){ const {page}=await openPage(ctxs.alice,`${L.BASE}/app/channels/${E[k]}`); await L.sleep(3500);
   const shown=await page.evaluate(()=>[...document.querySelectorAll('[data-channel-scroll] [data-message-id]')].map(n=>({id:n.getAttribute('data-message-id'),t:n.innerText})));
   const roots=truth[k].filter(x=>!x.del); const tail=roots.slice(0,15).map(x=>x.id).reverse();
   const shownIds=new Set(shown.map(s=>s.id)); const missing=tail.filter(id=>!shownIds.has(id));
   const lastShown=shown.filter(s=>truth[k].some(t=>t.id===s.id)).slice(-1)[0]; out.reload[k]={latestServer:truth[k][0].id,lastShownRoot:lastShown&&lastShown.id,match:lastShown&&lastShown.id===truth[k][0].id,missingOfLast15:missing.length};
   await page.close(); }
 // E2 rapid switching
 const {page}=await openPage(ctxs.alice,`${L.BASE}/app/channels/${E.freshness}`); await L.sleep(3000);
 const seq=['lobby','small','medium','freshness','large','small','lobby','freshness','medium','large']; out.switch=[];
 for(const k of seq){ await page.locator('[role=treeitem]').filter({hasText:new RegExp('^'+names[k])}).first().click(); await L.sleep(350); 
   const st=await page.evaluate(()=>({hdr:(document.querySelector('[data-channel-scroll]')?.closest('div')?.parentElement?.parentElement?.innerText||'').slice(0,0),rows:[...document.querySelectorAll('[data-channel-scroll] [data-message-id]')].map(n=>n.getAttribute('data-message-id'))}));
   out.switch.push({k,early:st.rows.length}); }
 // final: wait & verify content of final channel plus intermediate check with settle for each pass
 await L.sleep(3000);
 out.final=await page.evaluate(()=>({url:location.pathname,rows:[...document.querySelectorAll('[data-channel-scroll] [data-message-id]')].length}));
 // 10 switches with verification that after settle (1.5s) all rows belong to the channel
 out.verify=[]; const large=new Set(require('./large-ids.json'));
 for(const k of seq){ await page.locator('[role=treeitem]').filter({hasText:new RegExp('^'+names[k])}).first().click(); await L.sleep(1800);
   const rows=await page.evaluate(()=>[...document.querySelectorAll('[data-channel-scroll] [data-message-id]')].map(n=>n.getAttribute('data-message-id')));
   const set=k==='large'?large:new Set(truth[k].map(x=>x.id)); const foreign=rows.filter(r=>!set.has(r)); // replies/new msgs may be unknown; check against other channels
   const other=Object.keys(truth).filter(o=>o!==k&&o!=='large').flatMap(o=>truth[o].map(x=>x.id)); const otherSet=new Set(other); const stale=rows.filter(r=>otherSet.has(r)||(k!=='large'&&large.has(r))).length;
   out.verify.push({k,rows:rows.length,unknownToTruth:foreign.length,staleFromOtherChannel:stale,url:new URL(page.url()).pathname.split('/').pop().slice(0,8)}); }
 await page.screenshot({path:`${DIR}/e-switch.png`});
 console.log(JSON.stringify(out)); fs.writeFileSync(DIR+'/e.json',JSON.stringify(out,null,1)); dumpIssues('e'); await browser.close();})().catch(e=>{console.error(e);process.exit(1)});
