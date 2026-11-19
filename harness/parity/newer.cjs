const {L,setup,openPage,DIR}=require('./common.cjs');
const FX=require('../fixture.json').channels.large; const ch=L.ENV.channels.large;
const idx=new Map(require('./large-ids.json').map((x,i)=>[x,i]));
(async()=>{
 const {browser,ctxs}=await setup();
 const {page}=await openPage(ctxs.alice,`${L.BASE}/app/channels/${ch}?channel_message_id=${FX.oldRoot.id}`,`[data-message-id="${FX.oldRoot.id}"]`);
 const ops=[]; page.on('request',r=>{ if(/graphql|timeline/.test(r.url())){let o='';try{o=JSON.parse(r.postData()||'{}')}catch{} ops.push((o.operationName||'rest')+' '+Date.now());}});
 await L.sleep(3000);
 for(let i=0;i<120;i++){ await page.mouse.move(800,450); await page.mouse.wheel(0,500); await L.sleep(250);
  if(i%10==0){ console.log(i, await page.evaluate(()=>{const s=document.querySelector('[data-channel-scroll]');const n=[...document.querySelectorAll('[data-channel-scroll] [data-message-id]')];return [Math.round(s.scrollTop),Math.round(s.scrollHeight-s.scrollTop-s.clientHeight),n.length&&n[0].getAttribute('data-message-id'),n.length&&n[n.length-1].getAttribute('data-message-id')]}).then(a=>[a[0],a[1],idx.get(a[2]),idx.get(a[3])].join(' ')), ops.length);} }
 console.log(ops.slice(-10).join('\n')); await page.screenshot({path:DIR+'/newer-explore.png'}); await browser.close();})();
