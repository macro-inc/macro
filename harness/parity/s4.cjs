const {L,setup,j,DIR,dumpIssues,attach}=require('./common.cjs'); const E=L.ENV.channels; const out={};
const old=require('./large-all.json').map(e=>e.message)[2000];
(async()=>{ const {browser,ctxs}=await setup(); const page=await ctxs.alice.newPage(); attach(page,{});
 await page.goto(`${L.BASE}/app/search`); await L.sleep(5000);
 out.active=await page.evaluate(()=>{const a=document.activeElement;return a.tagName+'|'+a.isContentEditable+'|'+(a.getAttribute('placeholder')||a.getAttribute('aria-label')||'')});
 await page.screenshot({path:`${DIR}/a4-search-page.png`});
 await page.mouse.click(500,31); await L.sleep(500); out.active2=await page.evaluate(()=>{const a=document.activeElement;return a.tagName+'|'+a.isContentEditable}); if(/INPUT|true/.test(out.active2)){ const q=process.argv[2]||'far-mention'; out.q=q; await page.keyboard.type(q); await L.sleep(7000); await page.screenshot({path:`${DIR}/a4-search.png`});
  out.res=await page.evaluate(()=>document.body.innerText.slice(0,1200)); }
 console.log(JSON.stringify(out,null,1)); dumpIssues('s4'); await browser.close();})().catch(e=>{console.error(e);console.log(JSON.stringify(out));process.exit(1)});
