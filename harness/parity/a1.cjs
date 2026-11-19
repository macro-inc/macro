const {L,setup,j,openPage,rows,DIR,dumpIssues}=require('./common.cjs'); const fs=require('fs');
const FX=require('../fixture.json').channels.large; const ch=L.ENV.channels.large;
const urlName=process.argv[2]||'a1';
const URLS={
 a1:`${L.BASE}/app/channels/${ch}?channel_message_id=${FX.oldRoot.id}`,
 a1_home:`${L.BASE}/app/channel/${ch}?channel_message_id=${FX.oldRoot.id}`,
 a2:`${L.BASE}/app/channels/${ch}?channel_message_id=${FX.threadReply.replyId}&channel_thread_id=${FX.threadReply.rootId}`,
 a2_noThreadParam:`${L.BASE}/app/channels/${ch}?channel_message_id=${FX.threadReply.replyId}`,
 a2_root:`${L.BASE}/app/channels/${ch}?channel_thread_id=${FX.threadReply.rootId}`,
};
const target = urlName.startsWith('a2')&&urlName!=='a2_root'?FX.threadReply.replyId:(urlName==='a2_root'?FX.threadReply.rootId:FX.oldRoot.id);
(async()=>{
 const {browser,ctxs}=await setup(); const out={url:URLS[urlName],target};
 const t0=Date.now();
 const {page}=await openPage(ctxs.alice,URLS[urlName],`[data-message-id="${target}"]`);
 out.firstTargetMs=Date.now()-t0;
 // sample target top & targeted flag
 const samples=[]; for(let i=0;i<24;i++){ samples.push(await page.evaluate((t)=>{const n=document.querySelector(`[data-message-id="${t}"]`);const s=document.querySelector('[data-channel-scroll]');return n?{top:Math.round(n.getBoundingClientRect().top),targeted:n.hasAttribute('data-targeted'),n:document.querySelectorAll('[data-channel-scroll] [data-message-id]').length,st:s&&Math.round(s.scrollTop)}:null},target)); await L.sleep(250); }
 out.samples=samples.map(s=>s?`${s.top}/${s.targeted?'T':'-'}/${s.n}/${s.st}`:'null');
 await page.screenshot({path:`${DIR}/${urlName}-landed.png`});
 out.url_after=page.url();
 // page older: scroll up
 const rowsInfo=async()=>page.evaluate(()=>{const ids=[...document.querySelectorAll('[data-channel-scroll] [data-message-id]')].map(n=>n.getAttribute('data-message-id'));return {n:ids.length,dups:ids.length-new Set(ids).size}});
 const scroll=(dy)=>page.evaluate((dy)=>{const s=document.querySelector('[data-channel-scroll]');s.scrollTop+=dy;},dy);
 const firstIdTop=async()=>page.evaluate(()=>{const n=[...document.querySelectorAll('[data-channel-scroll] [data-message-id]')];return n.length?n[0].getAttribute('data-message-id'):null});
 const f0=await firstIdTop();
 for(let i=0;i<12;i++){ await scroll(-1500); await L.sleep(500); }
 out.afterOlder={first_before:f0,first_after:await firstIdTop(),...await rowsInfo()};
 await page.screenshot({path:`${DIR}/${urlName}-older.png`});
 // newer
 for(let i=0;i<30;i++){ await scroll(1800); await L.sleep(400); }
 out.afterNewer={...await rowsInfo(), last:await page.evaluate(()=>{const n=[...document.querySelectorAll('[data-channel-scroll] [data-message-id]')];return n.length?n[n.length-1].getAttribute('data-message-id'):null})};
 await page.screenshot({path:`${DIR}/${urlName}-newer.png`});
 // jump to latest button
 const btn=page.getByRole('button',{name:/scroll to bottom|jump to latest|latest/i});
 out.btnCount=await btn.count();
 // go far back again first
 for(let i=0;i<6;i++){ await scroll(-1800); await L.sleep(300); }
 out.btnVisible=await btn.first().isVisible().catch(()=>false);
 if(out.btnVisible){ await btn.first().click(); await L.sleep(3000);
   out.afterJump=await page.evaluate(()=>{const s=document.querySelector('[data-channel-scroll]');const n=[...document.querySelectorAll('[data-channel-scroll] [data-message-id]')];return {gapToBottom:Math.round(s.scrollHeight-s.scrollTop-s.clientHeight),last:n.length&&n[n.length-1].getAttribute('data-message-id')}});
   out.latestRoot=require('./large-all.json')[0].message.id;
   await page.screenshot({path:`${DIR}/${urlName}-jumped.png`});
 }
 console.log(JSON.stringify(out,null,1)); fs.writeFileSync(`${DIR}/${urlName}.json`,JSON.stringify(out,null,1));
 dumpIssues(urlName); await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
