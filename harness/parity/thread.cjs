const {L,setup,j,openPage,DIR,dumpIssues}=require('./common.cjs'); const fs=require('fs');
const FX=require('../fixture.json').channels.large; const ch=L.ENV.channels.large;
(async()=>{
 const {browser,ctxs}=await setup(); const out={};
 const api=`${L.BASE}/dss/messages/channel/${ch}/threads/${FX.threadReply.rootId}`;
 const t=await j(await ctxs.alice.request.get(api)); out.restStatus=t.status; const rep=(t.body.replies||t.body.entries||[]); out.restKeys=Object.keys(t.body); out.restReplies=rep.length;
 const {page}=await openPage(ctxs.alice,`${L.BASE}/app/channels/${ch}?channel_message_id=${FX.threadReply.replyId}&channel_thread_id=${FX.threadReply.rootId}`,`[data-message-id="${FX.threadReply.replyId}"]`);
 await L.sleep(2500);
 const seen=new Set(); const collect=async()=>(await page.evaluate(()=>[...document.querySelectorAll('[data-channel-scroll] [data-message-id]')].map(n=>n.getAttribute('data-message-id')))).forEach(i=>seen.add(i));
 for(let i=0;i<120;i++){ await page.mouse.move(800,450); await page.mouse.wheel(0,-400); await L.sleep(100); await collect(); if(seen.has(FX.threadReply.rootId)&&i>5) { const top=await page.evaluate((r)=>{const n=document.querySelector(`[data-message-id="${r}"]`);return n&&Math.round(n.getBoundingClientRect().top)},FX.threadReply.rootId); if(top!==null&&top>60) {out.rootTop=top;out.stoppedAt=i;break;} } }
 await L.sleep(1000); await collect();
 out.upSeen=seen.size; await page.screenshot({path:`${DIR}/a8-thread-start.png`});
 const replyIds=new Set(rep.map(r=>r.id||r.message?.id)); out.restIds=replyIds.size;
 out.replyIdsSeenOfRest=[...seen].filter(i=>replyIds.has(i)).length;
 out.rootSeen=seen.has(FX.threadReply.rootId);
 for(let i=0;i<160;i++){ await page.mouse.wheel(0,500); await L.sleep(100); await collect(); }
 out.afterDownSeenOfRest=[...seen].filter(i=>replyIds.has(i)).length;
 await page.screenshot({path:`${DIR}/a8-thread-end.png`});
 console.log(JSON.stringify(out,null,1)); dumpIssues('a8'); await browser.close();})().catch(e=>{console.error(e);process.exit(1)});
