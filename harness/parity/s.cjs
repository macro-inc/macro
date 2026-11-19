const {L,setup,j,openPage,DIR,dumpIssues}=require('./common.cjs'); const fs=require('fs'); const E=L.ENV.channels; const FX=require('../fixture.json').channels.large; const out={};
const old=require('./large-all.json').map(e=>e.message)[2000];
(async()=>{ const {browser,ctxs}=await setup(['alice@seed.macro.local']);
 // A3: link to old message sent inside freshness
 const api=`${L.BASE}/dss/messages/channel/${E.freshness}`; const T=Date.now(); const link=`${L.BASE}/app/channels/${E.large}?channel_message_id=${old.id}`;
 let r=await j(await ctxs.alice.request.post(api,{data:{content:`par-link-${T} ${link}`,nonce:`pl${T}`}})); out.postStatus=r.status;
 const {page}=await openPage(ctxs.alice,`${L.BASE}/app/channels/${E.freshness}`); await L.sleep(4000);
 const a=page.locator(`[data-message-id="${r.body.id}"] a`).first(); out.linkCount=await a.count();
 if(out.linkCount){ out.linkText=(await a.innerText()).slice(0,100); await a.click(); await L.sleep(5000); out.urlAfter=page.url().replace(L.BASE,''); out.target=await page.evaluate((id)=>{const n=document.querySelector(`[data-message-id="${id}"]`);return n?{top:Math.round(n.getBoundingClientRect().top),targeted:n.hasAttribute('data-targeted')}:null},old.id); out.hdr=await page.evaluate(()=>document.querySelector('[data-channel-scroll]')?.closest('div')?.parentElement?.innerText.slice(0,60)); await page.screenshot({path:`${DIR}/a3-link-click.png`}); }
 // A4: search
 await page.goto(`${L.BASE}/app/channels/${E.large}`); await page.waitForSelector('[data-channel-scroll] [data-message-id]'); await L.sleep(2000);
 const q=old.content.split(' ').slice(0,6).join(' '); out.query=q;
 await page.locator('[aria-label*="earch" i]').first().click().catch(()=>{}); await L.sleep(1000); await page.keyboard.type(q); await L.sleep(4000); await page.screenshot({path:`${DIR}/a4-search.png`});
 out.results=await page.evaluate(()=>[...document.querySelectorAll('[role=option],[role=listitem],[data-search-result]')].slice(0,8).map(n=>n.innerText.replace(/\n+/g,'|').slice(0,100)));
 console.log(JSON.stringify(out,null,1)); dumpIssues('s'); await browser.close();})().catch(e=>{console.error(e);console.log(JSON.stringify(out));process.exit(1)});
