const {L,setup,j,openPage,DIR,dumpIssues}=require('./common.cjs'); const fs=require('fs');
const FX=require('../fixture.json').channels.large; const ch=L.ENV.channels.large;
const truth=require('./large-ids.json'); const idx=new Map(truth.map((x,i)=>[x,i]));
const name=process.argv[2];
const URLS={
 a1:`${L.BASE}/app/channels/${ch}?channel_message_id=${FX.oldRoot.id}`,
 a1_home:`${L.BASE}/app/channel/${ch}?channel_message_id=${FX.oldRoot.id}`,
 a1_legacy:`${L.BASE}/app/home/~/channel/${ch}?channel_message_id=${FX.oldRoot.id}`,
 a1_legacy2:`${L.BASE}/app/channel/${ch}?channel_thread_id=${FX.oldRoot.id}`,
 a2:`${L.BASE}/app/channels/${ch}?channel_message_id=${FX.threadReply.replyId}&channel_thread_id=${FX.threadReply.rootId}`,
 a2_nothread:`${L.BASE}/app/channels/${ch}?channel_message_id=${FX.threadReply.replyId}`,
 a2_root:`${L.BASE}/app/channels/${ch}?channel_thread_id=${FX.threadReply.rootId}`,
};
const target=name.startsWith('a1')?FX.oldRoot.id:name==='a2_root'?FX.threadReply.rootId:FX.threadReply.replyId;
const snap=(page,t)=>page.evaluate((t)=>{const n=document.querySelector(`[data-message-id="${t}"]`);const s=document.querySelector('[data-channel-scroll]');return n?`${Math.round(n.getBoundingClientRect().top)}/${n.hasAttribute('data-targeted')?'T':'-'}/${document.querySelectorAll('[data-channel-scroll] [data-message-id]').length}/${s&&Math.round(s.scrollTop)}`:'null'},t);
(async()=>{
 const {browser,ctxs}=await setup(); const out={url:URLS[name],target};
 const t0=Date.now();
 const {page}=await openPage(ctxs.alice,URLS[name],`[data-message-id="${target}"]`);
 out.firstTargetMs=Date.now()-t0;
 const samples=[]; for(let i=0;i<10;i++){ samples.push(await snap(page,target)); if(i===1) await page.screenshot({path:`${DIR}/${name}-landed.png`}); await L.sleep(300);} out.samples=samples; out.urlAfter=page.url().replace(L.BASE,'');
 // stillness: sample while neighbours page in
 await L.sleep(2500); out.settled=await snap(page,target);
 if(name.startsWith('a1')){
  const seen=new Set(); const collect=async()=>{ (await page.evaluate(()=>[...document.querySelectorAll('[data-channel-scroll] [data-message-id]')].map(n=>n.getAttribute('data-message-id')))).forEach(i=>seen.add(i)); };
  const step=async(dy)=>{ await page.mouse.move(800,450); await page.mouse.wheel(0,dy); await L.sleep(120); await collect(); };
  for(let i=0;i<90;i++) await step(-500); out.upSeen=seen.size;
  await page.screenshot({path:`${DIR}/${name}-older.png`});
  for(let i=0;i<200;i++) await step(500); 
  await L.sleep(1000); await collect();
  const arr=[...seen]; const inT=arr.filter(i=>idx.has(i)).map(i=>idx.get(i)).sort((a,b)=>a-b);
  const gaps=[]; for(let k=1;k<inT.length;k++) if(inT[k]!==inT[k-1]+1) gaps.push([inT[k-1],inT[k]]);
  out.walk={seen:arr.length,notInTruth:arr.length-inT.length,minIdx:inT[0],maxIdx:inT[inT.length-1],gaps:gaps.slice(0,10),nGaps:gaps.length};
  await page.screenshot({path:`${DIR}/${name}-newer.png`});
  out.domDupIds=await page.evaluate(()=>{const ids=[...document.querySelectorAll('[data-channel-scroll] [data-message-id]')].map(n=>n.getAttribute('data-message-id'));return ids.length-new Set(ids).size});
  // scroll far to the newest loaded or bottom
  const st=await page.evaluate(()=>{const s=document.querySelector('[data-channel-scroll]');return {gap:Math.round(s.scrollHeight-s.scrollTop-s.clientHeight)}}); out.bottomGap=st.gap;
  out.lastDomIdx=await page.evaluate(()=>{const n=[...document.querySelectorAll('[data-channel-scroll] [data-message-id]')];return n.length?n[n.length-1].getAttribute('data-message-id'):null}).then(i=>idx.get(i));
 } else {
  await page.screenshot({path:`${DIR}/${name}-after.png`});
 }
 console.log(JSON.stringify(out,null,1)); fs.writeFileSync(`${DIR}/${name}.json`,JSON.stringify(out,null,1));
 dumpIssues(name); await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
