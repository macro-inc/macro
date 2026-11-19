const {L,setup,openPage,DIR}=require('./common.cjs'); const ch=L.ENV.channels.large;
(async()=>{ const {browser,ctxs}=await setup(); const id='01a1c2d0-306d-70b7-b059-07f0a24afba8';
 const {page}=await openPage(ctxs.alice,`${L.BASE}/app/channels/${ch}?channel_message_id=${id}`,`[data-message-id="${id}"]`); await L.sleep(3000);
 await page.mouse.move(800,450); await page.mouse.wheel(0,-250); await L.sleep(800);
 await page.screenshot({path:DIR+'/b-divider.png'});
 console.log(await page.evaluate(()=>[...document.querySelectorAll('[data-channel-scroll] *')].filter(e=>e.children.length===0&&/^(Today|Yesterday|[A-Z][a-z]+day|[A-Z][a-z]{2} \d+|New)/.test(e.textContent.trim())&&e.textContent.length<40).map(e=>e.textContent)));
 await browser.close();})();
