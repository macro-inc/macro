const {L,setup,j,openPage,DIR,dumpIssues}=require('./common.cjs'); const E=L.ENV.channels; const lob=`${L.BASE}/dss/messages/channel/${E.lobby}`; const T=Date.now();
const how=process.argv[2]; const n=+process.argv[3];
(async()=>{ const {browser,ctxs}=await setup(['alice@seed.macro.local','bob@seed.macro.local']);
 let page;
({page}=await openPage(ctxs.alice,`${L.BASE}/app/channels/${E.freshness}`)); await L.sleep(3000);
 for(let i=0;i<n;i++) await j(await ctxs.bob.request.post(lob,{data:{content:`h4-${i}-${T}`,nonce:`h4${i}${T}`}}));
 await L.sleep(3000);
 if(how==='sidebar') await page.locator('[role=treeitem]').filter({hasText:/^lobby/}).first().click(); else { await page.locator('[aria-label*="otification" i]').first().click(); await L.sleep(2500); await page.getByText('#lobby').first().click(); }
 await L.sleep(4000);
 const o={how,n}; o.chip=await page.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Unread notification/.test(b.innerText));return b?b.innerText.replace(/\n+/g,' '):null});
 o.newDivider=await page.evaluate(()=>/(^|\n)New(\n|$)|- New/.test(document.querySelector('[data-channel-scroll]').innerText));
 await page.screenshot({path:`${DIR}/h4-${how}-${n}.png`}); console.log(JSON.stringify(o)); dumpIssues('h3'); await browser.close();})().catch(e=>{console.error(e);process.exit(1)});
