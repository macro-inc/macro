const {L,setup,j,openPage,DIR,dumpIssues}=require('./common.cjs'); const fs=require('fs');
const FX=require('../fixture.json').channels.large; const ch=L.ENV.channels.large;
const latest=require('./large-ids.json')[0];
(async()=>{
 const {browser,ctxs}=await setup(); const out={};
 const {page}=await openPage(ctxs.alice,`${L.BASE}/app/channels/${ch}?channel_message_id=${FX.oldRoot.id}`,`[data-message-id="${FX.oldRoot.id}"]`);
 await L.sleep(3000);
 for(let i=0;i<10;i++){await page.mouse.move(800,450);await page.mouse.wheel(0,500);await L.sleep(200);}
 out.buttons=await page.evaluate(()=>[...document.querySelectorAll('button')].filter(b=>b.getBoundingClientRect().width>0).map(b=>(b.getAttribute('aria-label')||b.title||b.textContent||'').trim().slice(0,40)).filter(x=>/bottom|latest|down|jump/i.test(x)));
 const btn=page.getByRole('button',{name:/scroll to bottom|jump to latest|latest|bottom/i}).first();
 out.vis=await btn.isVisible().catch(()=>false);
 await page.screenshot({path:`${DIR}/a7-before-jump.png`});
 const reqs=[]; page.on('request',r=>{if(/timeline|graphql/.test(r.url())){let o={};try{o=JSON.parse(r.postData()||'{}')}catch{} reqs.push(o.operationName||'rest')}});
 const t0=Date.now();
 if(out.vis){await btn.click();
  await L.waitFor(async()=>await page.evaluate((id)=>!!document.querySelector(`[data-message-id="${id}"]`),latest)||null,{timeout:15000,interval:50}).then(()=>out.latestVisibleMs=Date.now()-t0);
  await L.sleep(3000);
  out.after=await page.evaluate((id)=>{const s=document.querySelector('[data-channel-scroll]');const n=[...document.querySelectorAll('[data-channel-scroll] [data-message-id]')];return {gap:Math.round(s.scrollHeight-s.scrollTop-s.clientHeight),last:n[n.length-1]?.getAttribute('data-message-id'),isLatest:n[n.length-1]?.getAttribute('data-message-id')===id}},latest);
  out.reqs=reqs; await page.screenshot({path:`${DIR}/a7-after-jump.png`});
  // paging back older after jump
  for(let i=0;i<40;i++){await page.mouse.wheel(0,-500);await L.sleep(100);}
  out.olderAfterJump=await page.evaluate(()=>document.querySelectorAll('[data-channel-scroll] [data-message-id]').length);
 }
 console.log(JSON.stringify(out,null,1)); dumpIssues('a7'); await browser.close();})().catch(e=>{console.error(e);process.exit(1)});
