const {L,setup,j,openPage,DIR,dumpIssues}=require('./common.cjs'); const fs=require('fs'); const E=L.ENV.channels; const out={};
const old=require('./large-all.json').map(e=>e.message)[2000];
(async()=>{ const {browser,ctxs}=await setup(['alice@seed.macro.local']);
 const {page}=await openPage(ctxs.alice,`${L.BASE}/app/channels/${E.freshness}`); await L.sleep(4000);
 // search
 const p2=page; await p2.goto(`${L.BASE}/app/channels/${E.large}`); await p2.waitForSelector('[data-channel-scroll] [data-message-id]'); await L.sleep(2000);
 await p2.mouse.click(1000,60); await p2.keyboard.press('/'); await L.sleep(1200); await L.sleep(1500); const q=old.content.split(' ').slice(0,5).join(' '); out.query=q;  out.active=await p2.evaluate(()=>{const a=document.activeElement;return a.tagName+'|'+a.getAttribute('role')+'|'+(a.closest('[role=dialog],[data-kb-popper-content]')?'inDialog':'outside')+'|'+a.isContentEditable+'|'+a.className.toString().slice(0,40)});
 if(/^INPUT/.test(out.active)||/true$/.test(out.active)&&/inDialog/.test(out.active)){ await p2.keyboard.type(q); await L.sleep(6000); } await p2.screenshot({path:`${DIR}/a4-search.png`});
 out.results=await p2.evaluate(()=>[...document.querySelectorAll('[role=option]')].slice(0,8).map(n=>n.innerText.replace(/\n+/g,'|').slice(0,120)));
 console.log(JSON.stringify(out,null,1)); dumpIssues('s2'); await browser.close();})().catch(e=>{console.error(e);console.log(JSON.stringify(out));process.exit(1)});
