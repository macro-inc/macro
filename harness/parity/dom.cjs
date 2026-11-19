const {L,setup,openPage}=require('./common.cjs'); const ch=L.ENV.channels.large;
(async()=>{ const {browser,ctxs}=await setup(); const {page}=await openPage(ctxs.alice,`${L.BASE}/app/channels/${ch}`); await L.sleep(3000);
 for(let i=0;i<30;i++){await page.mouse.move(800,450);await page.mouse.wheel(0,-500);await L.sleep(120);}
 console.log(await page.evaluate(()=>{const s=document.querySelector("[data-channel-scroll]"); const r=[...s.querySelectorAll("[data-index]")].map(e=>e.getAttribute("data-index")+" | "+(e.hasAttribute("data-message-id")?"MSG ":"OTHER ")+e.innerText.replace(/\n/g," ").slice(0,70)); return r.join("\n")}));
 await browser.close();})();
