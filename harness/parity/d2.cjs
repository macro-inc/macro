const {L,setup,j,openPage,DIR,dumpIssues}=require('./common.cjs'); const ch=L.ENV.channels.freshness; const api=`${L.BASE}/dss/messages/channel/${ch}`; const T=Date.now(); const out={};
(async()=>{ const {browser,ctxs}=await setup(['alice@seed.macro.local','bob@seed.macro.local']);
 const {page}=await openPage(ctxs.alice,`${L.BASE}/app/channels/${ch}`); await L.sleep(4000);
 const gap=()=>page.evaluate(()=>{const s=document.querySelector('[data-channel-scroll]');return Math.round(s.scrollHeight-s.scrollTop-s.clientHeight)});
 for(let i=0;i<30;i++){await page.mouse.move(800,450);await page.mouse.wheel(0,-500);await L.sleep(100);}
 await page.mouse.wheel(0,300);await L.sleep(300);await page.mouse.wheel(0,300);await L.sleep(500);out.gapUp=await gap(); const b=page.getByRole('button',{name:/scroll to bottom/i}).first(); out.btnVisible=await b.isVisible().catch(()=>false);
 await page.screenshot({path:`${DIR}/d2-up.png`});
 console.log(JSON.stringify(out));await b.click({timeout:3000}).catch(()=>{}); await L.sleep(2500); out.afterJumpGap=await gap();
 const M=`par-D2-after-jump-${T}`; await j(await ctxs.bob.request.post(api,{data:{content:M,nonce:`d2${T}`}})); await L.sleep(2500); out.afterJumpNewGap=await gap();
 out.shown=await page.evaluate((M)=>[...document.querySelectorAll('[data-channel-scroll] [data-message-id]')].filter(n=>n.textContent.includes(M)).length,M); await page.screenshot({path:`${DIR}/d2-pinned.png`});
 console.log(JSON.stringify(out)); dumpIssues('d2'); await browser.close();})();
