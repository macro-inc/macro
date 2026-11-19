const {L,setup,j,openPage,DIR,dumpIssues}=require('./common.cjs'); const fs=require('fs'); const E=L.ENV.channels; const lob=`${L.BASE}/dss/messages/channel/${E.lobby}`; const T=Date.now(); const out={};
const mode=process.argv[2];
(async()=>{ const {browser,ctxs}=await setup(['alice@seed.macro.local','bob@seed.macro.local']);
 // make sure lobby is read
 let {page}=await openPage(ctxs.alice,`${L.BASE}/app/channels/${E.lobby}`); await L.sleep(3000); await page.close();
 ({page}=await openPage(ctxs.alice,`${L.BASE}/app/channels/${E.freshness}`)); await L.sleep(3000);
 if(mode==='visited'){ await page.locator('[role=treeitem]').filter({hasText:/^lobby/}).first().click(); await L.sleep(3000); await page.locator('[role=treeitem]').filter({hasText:/^freshness/}).first().click(); await L.sleep(2500); }
 for(let i=0;i<30;i++) await j(await ctxs.bob.request.post(lob,{data:{content:`h2-${mode}-${i}-${T}`,nonce:`h2${i}${T}`}}));
 await L.sleep(3000);
 const how=process.argv[3]||'sidebar';
 if(how==='sidebar') await page.locator('[role=treeitem]').filter({hasText:/^lobby/}).first().click(); else { await page.close(); ({page}=await openPage(ctxs.alice,`${L.BASE}/app/channels/${E.lobby}`)); }
 await L.sleep(3500);
 out.chip=await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Unread notification/.test(b.innerText));return b?b.innerText.replace(/\n+/g,' '):null});
 out.newDivider=await page.evaluate(()=>/(^|\n)New(\n|$)|- New/.test(document.querySelector('[data-channel-scroll]').innerText));
 out.gap=await page.evaluate(()=>{const s=document.querySelector('[data-channel-scroll]');return Math.round(s.scrollHeight-s.scrollTop-s.clientHeight)});
 await page.screenshot({path:`${DIR}/h2-${mode}-${how}.png`}); console.log(mode,how,JSON.stringify(out)); dumpIssues('h2'); await browser.close();})().catch(e=>{console.error(e);process.exit(1)});
