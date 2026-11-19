const {L,setup,openPage,DIR}=require('./common.cjs'); const E=L.ENV.channels; const old=require('./large-all.json').map(e=>e.message)[2000]; const out={};
(async()=>{ const {browser,ctxs}=await setup(); const {page}=await openPage(ctxs.alice,`${L.BASE}/app/channels/${E.large}`); await L.sleep(2500);
 await page.locator('[aria-label*="earch" i]').first().click(); await L.sleep(1500);
 out.inputs=await page.evaluate(()=>[...document.querySelectorAll('input,textarea,[contenteditable],[role=combobox],[role=searchbox]')].map(n=>n.tagName+'|'+(n.getAttribute('placeholder')||'')+'|'+(n.getAttribute('aria-label')||'')+'|'+(n.getAttribute('role')||'')+'|'+Math.round(n.getBoundingClientRect().width)));
 console.log(JSON.stringify(out)); await browser.close();})();
