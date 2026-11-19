const {L,setup,j,openPage,DIR,dumpIssues}=require('./common.cjs'); const fs=require('fs'); const E=L.ENV.channels; const lob=`${L.BASE}/dss/messages/channel/${E.lobby}`; const T=Date.now(); const out={};
(async()=>{ const {browser,ctxs}=await setup(['alice@seed.macro.local','bob@seed.macro.local']);
 const {page}=await openPage(ctxs.alice,`${L.BASE}/app/channels/${E.freshness}`); await L.sleep(3000);
 const mention=`Hey <m-user-mention>{"userId":"macro|alice@seed.macro.local","email":"alice@seed.macro.local","displayName":"Alice Quinn"}</m-user-mention> far-mention-${T}`;
 let r=await j(await ctxs.bob.request.post(lob,{data:{content:mention,mentions:[{entity_type:'user',entity_id:'macro|alice@seed.macro.local'}],nonce:`gm${T}`}})); const mid=r.body.id; out.mid=mid;
 for(let i=0;i<70;i++){ await j(await ctxs.bob.request.post(lob,{data:{content:`filler-${i}-${T}`,nonce:`gf${i}${T}`}})); }
 await L.sleep(3000);
 // sidebar: lobby row text/badge
 const lobbyRow=page.locator('[role=treeitem]').filter({hasText:/^lobby/}).first();
 out.lobbyRowBefore=await lobbyRow.evaluate(n=>({text:n.innerText.replace(/\n+/g,'|'),html:n.innerHTML.length,unreadish:[...n.querySelectorAll('*')].filter(e=>/unread|badge|dot/i.test(e.className&&e.className.toString())).map(e=>e.className.toString().slice(0,60)).slice(0,5)}));
 await page.screenshot({path:`${DIR}/g-sidebar-unread.png`,clip:{x:0,y:90,width:320,height:620}});
 // click notification (Inbox)
 await page.locator('[aria-label*="otification" i]').first().click(); await L.sleep(2500); await page.screenshot({path:`${DIR}/g-inbox.png`});
 await page.getByText('Bob in #lobby').first().click().catch(async e=>{out.inboxClickErr=String(e).slice(0,100)}); await L.sleep(5000);
 out.url=page.url().replace(L.BASE,'');
 const st=await page.evaluate((mid)=>{const n=document.querySelector(`[data-message-id="${mid}"]`);const s=document.querySelector('[data-channel-scroll]');return {present:!!n,top:n&&Math.round(n.getBoundingClientRect().top),targeted:n&&n.hasAttribute('data-targeted'),gap:Math.round(s.scrollHeight-s.scrollTop-s.clientHeight)}},mid); out.afterInboxClick=st;
 await page.screenshot({path:`${DIR}/g-inbox-click.png`});
 console.log(JSON.stringify(out,null,1)); fs.writeFileSync(DIR+'/g.json',JSON.stringify(out,null,1)); dumpIssues('g'); await browser.close();})().catch(e=>{console.error(e);console.log(JSON.stringify(out));process.exit(1)});
