const {L,setup,openPage}=require('./common.cjs'); const ch=L.ENV.channels.large;
(async()=>{ const {browser,ctxs}=await setup(); const {page}=await openPage(ctxs.alice,`${L.BASE}/app/channels/${ch}`); await L.sleep(3000);
 for(let i=0;i<60;i++){await page.mouse.move(800,450);await page.mouse.wheel(0,-500);await L.sleep(120);}
 console.log(await page.evaluate(()=>{const lines=document.querySelector("[data-channel-scroll]").innerText.split("\n").filter(l=>l.length<30&&!/^[A-Z]{2}$/.test(l)&&!/ (AM|PM)/.test(l)); return lines.join(" ;; ").slice(0,1500)}));
 await page.screenshot({path:'/home/teo/.cache/channels-perf-b/parity/dom2.png'});
 await browser.close();})();
