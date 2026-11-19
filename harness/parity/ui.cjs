const {L,setup,openPage,DIR}=require('./common.cjs'); const ch=L.ENV.channels.freshness;
(async()=>{ const {browser,ctxs}=await setup(); const {page}=await openPage(ctxs.alice,`${L.BASE}/app/channels/${ch}`); await L.sleep(4000);
 const ed=page.locator('[data-markdown-editable]').last(); await ed.click(); const m='ui-probe-'+Date.now(); await page.keyboard.type(m); await page.keyboard.press('Enter'); await L.sleep(2500);
 const row=page.locator(`[data-channel-scroll] [data-message-id]:has-text("${m}")`).first(); await row.hover(); await L.sleep(500);
 console.log(await row.evaluate(n=>[...n.querySelectorAll('[data-message-action],button')].map(b=>[b.getAttribute('data-message-action'),b.getAttribute('aria-label'),b.title].join('/'))));
 await page.screenshot({path:DIR+'/ui-hover.png'});
 await page.keyboard.press('Escape');
 console.log(await page.evaluate(()=>[...document.querySelectorAll('[data-channel-scroll] [data-message-id]')].slice(-3).map(n=>n.innerText.replace(/\n+/g,'|').slice(0,80))));
 await browser.close();})();
