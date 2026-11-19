const {L,setup,DIR,attach}=require('./common.cjs'); const E=L.ENV.channels; const mid='01a1cf93-b6c8-740c-8145-937f375d1ce2';
const urls={lobbyOld:`${L.BASE}/app/channels/${E.lobby}?channel_message_id=${mid}`,largeOld:`${L.BASE}/app/channels/${E.large}?channel_message_id=${require('../fixture.json').channels.large.oldRoot.id}`,largeThread:`${L.BASE}/app/channels/${E.large}?channel_message_id=${require('../fixture.json').channels.large.threadReply.replyId}&channel_thread_id=${require('../fixture.json').channels.large.threadReply.rootId}`};
const ids={lobbyOld:mid,largeOld:require('../fixture.json').channels.large.oldRoot.id,largeThread:require('../fixture.json').channels.large.threadReply.replyId};
(async()=>{ const {browser,ctxs}=await setup(); for(const k of Object.keys(urls)){ for(let rep=0;rep<2;rep++){
 const ctx=await L.newContext(browser,{storageState:await L.authState(browser,'alice@seed.macro.local'),insecure:true}); const page=await ctx.newPage(); attach(page,{});
 await page.addInitScript((id)=>{window.__log=[];let last='';const loop=()=>{const n=document.querySelector(`[data-message-id="${id}"]`);const s=document.querySelector('[data-channel-scroll]');const cur=n?Math.round(n.getBoundingClientRect().top)+'/'+(n.hasAttribute('data-targeted')?'T':'-'):'none'; if(cur!==last){window.__log.push([Math.round(performance.now()),cur,s?Math.round(s.scrollTop):null]);last=cur;} requestAnimationFrame(loop)};requestAnimationFrame(loop)},ids[k]);
 await page.goto(urls[k]); await page.waitForSelector(`[data-message-id="${ids[k]}"]`,{timeout:60000}).catch(()=>{}); await L.sleep(4000);
 console.log(k,rep,JSON.stringify(await page.evaluate(()=>window.__log.filter(x=>x[1]!=='none'||true).slice(0,14)))); await ctx.close(); } }
 await browser.close();})();
