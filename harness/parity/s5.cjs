const {L,setup,j,DIR,dumpIssues,attach}=require('./common.cjs'); const E=L.ENV.channels; const out={}; const mid='01a1cf93-b6c8-740c-8145-937f375d1ce2';
(async()=>{ const {browser,ctxs}=await setup(); const page=await ctxs.alice.newPage(); attach(page,{});
 await page.goto(`${L.BASE}/app/search`); await L.sleep(5000); await page.mouse.click(500,31); await L.sleep(500); await page.keyboard.type('far-mention'); await L.sleep(5000);
 await page.getByText('far-mention-',{exact:false}).first().click(); 
 const t0=Date.now(); const ok=await L.waitFor(async()=>await page.evaluate((id)=>!!document.querySelector(`[data-message-id="${id}"]`),mid)||null,{timeout:20000,interval:50}); out.targetMs=ok?Date.now()-t0:null;
 const samples=[]; for(let i=0;i<12;i++){ samples.push(await page.evaluate((id)=>{const n=document.querySelector(`[data-message-id="${id}"]`);const s=document.querySelector('[data-channel-scroll]');return n?`${Math.round(n.getBoundingClientRect().top)}/${n.hasAttribute('data-targeted')?'T':'-'}/${s&&Math.round(s.scrollTop)}`:'null'},mid)); if(i==1) await page.screenshot({path:`${DIR}/a4-search-landed.png`}); await L.sleep(300);} out.samples=samples; out.url=page.url().replace(L.BASE,'');
 // page newer by scrolling down to bottom then up
 const seen=new Set(); for(let i=0;i<60;i++){ await page.mouse.move(900,450); await page.mouse.wheel(0,600); await L.sleep(120); (await page.evaluate(()=>[...document.querySelectorAll('[data-channel-scroll] [data-message-id]')].map(n=>n.getAttribute('data-message-id')))).forEach(x=>seen.add(x)); }
 await L.sleep(1500); out.bottomGap=await page.evaluate(()=>{const s=document.querySelector('[data-channel-scroll]');return Math.round(s.scrollHeight-s.scrollTop-s.clientHeight)}); out.seenAfterDown=seen.size; await page.screenshot({path:`${DIR}/a4-search-down.png`});
 out.last=await page.evaluate(()=>[...document.querySelectorAll('[data-channel-scroll] [data-message-id]')].slice(-1)[0].innerText.slice(0,40));
 console.log(JSON.stringify(out,null,1)); dumpIssues('s5'); await browser.close();})().catch(e=>{console.error(e);console.log(JSON.stringify(out));process.exit(1)});
