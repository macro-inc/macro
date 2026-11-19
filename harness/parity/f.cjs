const {L,setup,j,openPage,DIR,dumpIssues}=require('./common.cjs'); const fs=require('fs'); const E=L.ENV.channels; const lob=`${L.BASE}/dss/messages/channel/${E.lobby}`; const T=Date.now(); const out={};
(async()=>{ const {browser,ctxs}=await setup(['alice@seed.macro.local','bob@seed.macro.local']);
 const {page}=await openPage(ctxs.alice,`${L.BASE}/app/channels/${E.freshness}`); await L.sleep(4000);
 const side=()=>page.evaluate(()=>{const nav=[...document.querySelectorAll('a,[role=link],[role=treeitem],[role=option],li,button')].filter(n=>/^(freshness|perf-|lobby|Bob Marsh|Dave Okafor)/.test((n.textContent||'').trim())&&(n.textContent||'').length<40);return [...new Set(nav.map(n=>n.textContent.trim()+(n.querySelector('[class*=unread],[data-unread]')?' [UNREAD]':'')))]});
 out.sideBefore=await side(); await page.screenshot({path:`${DIR}/f-before.png`});
 // 6 messages in lobby from bob; 3rd mentions alice
 const mention=`Hey <m-user-mention>{"userId":"macro|alice@seed.macro.local","email":"alice@seed.macro.local","displayName":"Alice Quinn"}</m-user-mention> unread-check-${T}`;
 const ids=[];
 for(let i=0;i<6;i++){ const body=i===2?{content:mention,mentions:[{entity_type:'user',entity_id:'macro|alice@seed.macro.local'}],nonce:`f${i}${T}`}:{content:`unread-check-${i}-${T}`,nonce:`f${i}${T}`}; const r=await j(await ctxs.bob.request.post(lob,{data:body})); ids.push(r.body.id); out['post'+i]=r.status; await L.sleep(200);} out.mentionId=ids[2]; out.firstId=ids[0];
 await L.sleep(4000); out.sideAfter=await side(); await page.screenshot({path:`${DIR}/f-after-posts.png`});
 // bell
 await page.locator('[aria-label*="otification" i]').first().click().catch(e=>console.log('bell',String(e).slice(0,100))); await L.sleep(2500); await page.screenshot({path:`${DIR}/f-notifs.png`});
 out.notifText=await page.evaluate(()=>document.body.innerText.match(/.{0,60}unread-check.{0,60}/g));
 console.log(JSON.stringify(out,null,1)); fs.writeFileSync(DIR+'/f.json',JSON.stringify(out,null,1)); dumpIssues('f'); await browser.close();})().catch(e=>{console.error(e);console.log(JSON.stringify(out));process.exit(1)});
