const {L,setup,j,openPage,DIR,dumpIssues}=require('./common.cjs'); const fs=require('fs'); const E=L.ENV.channels; const lob=`${L.BASE}/dss/messages/channel/${E.lobby}`; const T=Date.now(); const out={};
(async()=>{ const {browser,ctxs}=await setup(['alice@seed.macro.local','bob@seed.macro.local']);
 const {page}=await openPage(ctxs.alice,`${L.BASE}/app/channels/${E.freshness}`); await L.sleep(3000);
 const dot=(name)=>page.evaluate((name)=>{const r=[...document.querySelectorAll('[role=treeitem]')].find(n=>n.innerText.trim().startsWith(name));return r?{text:r.innerText.replace(/\n+/g,'|'),dots:[...r.querySelectorAll('div,span')].filter(e=>{const c=e.className.toString();return /rounded-full/.test(c)&&e.getBoundingClientRect().width<=10&&e.getBoundingClientRect().width>0}).length}:null},name);
 out.dotBeforeAny=await dot('lobby');
 // clear any unread first by opening lobby then going back
 await page.locator('[role=treeitem]').filter({hasText:/^lobby/}).first().click(); await L.sleep(3000); await page.locator('[role=treeitem]').filter({hasText:/^freshness/}).first().click(); await L.sleep(2500);
 out.dotAfterClear=await dot('lobby');
 for(let i=0;i<30;i++) await j(await ctxs.bob.request.post(lob,{data:{content:`h-unread-${i}-${T}`,nonce:`h${i}${T}`}}));
 await L.sleep(3000); out.dotUnread=await dot('lobby'); out.order=await page.evaluate(()=>[...document.querySelectorAll('[role=treeitem]')].map(n=>n.innerText.trim().split('\n')[0]).slice(0,12));
 await page.screenshot({path:`${DIR}/h-side-unread.png`});
 await page.locator('[role=treeitem]').filter({hasText:/^lobby/}).first().click(); await L.sleep(2500);
 out.dotAfterOpen=await dot('lobby'); await page.screenshot({path:`${DIR}/h-opened.png`});
 out.chip=await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Unread notification/.test(b.innerText));return b?b.innerText.replace(/\n+/g,' '):null});
 out.newDivider=await page.evaluate(()=>/(^|\n)New(\n|$)|- New/.test(document.querySelector('[data-channel-scroll]').innerText));
 const chipBtn=page.getByRole('button',{name:/Unread notification/}).first();
 if(await chipBtn.count()){ await chipBtn.click(); await L.sleep(2500); await page.screenshot({path:`${DIR}/h-chip-clicked.png`}); out.afterChip=await page.evaluate(()=>{const s=document.querySelector('[data-channel-scroll]');return {gap:Math.round(s.scrollHeight-s.scrollTop-s.clientHeight),last:[...document.querySelectorAll('[data-message-id]')].slice(-1)[0].innerText.slice(0,40)}}); }
 await page.locator('[role=treeitem]').filter({hasText:/^freshness/}).first().click(); await L.sleep(2000); out.dotAfterLeave=await dot('lobby');
 console.log(JSON.stringify(out,null,1)); fs.writeFileSync(DIR+'/h.json',JSON.stringify(out,null,1)); dumpIssues('h'); await browser.close();})().catch(e=>{console.error(e);console.log(JSON.stringify(out));process.exit(1)});
