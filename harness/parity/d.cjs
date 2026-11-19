const {L,setup,j,openPage,DIR,dumpIssues}=require('./common.cjs'); const fs=require('fs'); const ch=L.ENV.channels.freshness; const api=`${L.BASE}/dss/messages/channel/${ch}`;
const T=Date.now(); const out={};
(async()=>{ const {browser,ctxs}=await setup(['alice@seed.macro.local','bob@seed.macro.local']);
 const {page}=await openPage(ctxs.alice,`${L.BASE}/app/channels/${ch}`); const bp=await openPage(ctxs.bob,`${L.BASE}/app/channels/${ch}`); await L.sleep(5000);
 const gap=()=>page.evaluate(()=>{const s=document.querySelector('[data-channel-scroll]');return Math.round(s.scrollHeight-s.scrollTop-s.clientHeight)});
 const info=(t)=>page.evaluate((t)=>[...document.querySelectorAll('[data-channel-scroll] [data-message-id]')].filter(n=>(n.textContent||'').includes(t)).map(n=>({id:n.getAttribute('data-message-id'),t:n.innerText.replace(/\n+/g,'|').slice(0,160),chips:n.querySelectorAll('[data-message-reaction-chip]').length})),t);
 const wait=async(f,ms=8000)=>{const t0=Date.now();const r=await L.waitFor(async()=>(await f())||null,{timeout:ms,interval:40});return r?Date.now()-t0:null;};
 out.gapBefore=await gap();
 // new message pinned
 const M=`par-D-new-${T}`; let r=await j(await ctxs.bob.request.post(api,{data:{content:M,nonce:`dn${T}`}})); const id=r.body.id; out.newPostStatus=r.status;
 out.new_ms=await wait(async()=>(await info(M)).length>0); await L.sleep(1500); out.gapAfterNew=await gap(); out.new_rows=(await info(M)).length; await page.screenshot({path:`${DIR}/d-new-pinned.png`});
 // burst of 5 while pinned
 for(let i=0;i<5;i++){await j(await ctxs.bob.request.post(api,{data:{content:`par-D-burst-${i}-${T}`,nonce:`db${i}${T}`}})); await L.sleep(250);} await L.sleep(2000); out.gapAfterBurst=await gap(); out.burstRows=(await page.evaluate((T)=>[...document.querySelectorAll('[data-channel-scroll] [data-message-id]')].filter(n=>(n.textContent||'').includes('par-D-burst-')&&n.textContent.includes(T)).length,T));
 // edit
 const E=`par-D-edited-${T}`; r=await j(await ctxs.bob.request.patch(`${api}/items/${id}`,{data:{content:E,mentions:[],attachments:{type:'preserve'},nonce:`de${T}`}})); out.editStatus=r.status;
 out.edit_ms=await wait(async()=>(await info(E)).length>0); const ie=await info(E); out.edit_after={rows:ie.length,t:ie[0]&&ie[0].t,oldRows:(await info(M)).length};
 // reaction
 r=await j(await ctxs.bob.request.post(`${api}/items/${id}/reactions`,{data:{emoji:'🎉',add:true,nonce:`dr${T}`}})); out.reactStatus=r.status; out.react_ms=await wait(async()=>(await info(E))[0]?.chips>0);
 r=await j(await ctxs.bob.request.post(`${api}/items/${id}/reactions`,{data:{emoji:'🎉',add:false,nonce:`dr2${T}`}})); out.unreact_ms=await wait(async()=>(await info(E))[0]?.chips===0);
 // thread replies x4 -> count/preview
 for(let i=0;i<4;i++){ r=await j(await ctxs.bob.request.post(api,{data:{content:`par-D-reply-${i}-${T}`,thread_id:id,nonce:`dt${i}${T}`}})); await L.sleep(300);} await L.sleep(2500);
 out.thread_text=await page.evaluate((id)=>{const r=document.querySelector(`[data-message-id="${id}"]`);const row=r.closest('[data-channel-thread-row]')||r.parentElement;return row.innerText.replace(/\n+/g,'|').slice(0,500)},id); await page.screenshot({path:`${DIR}/d-thread.png`});
 // typing
 const bed=bp.page.locator('[data-markdown-editable]').last(); await bed.click(); await bp.page.keyboard.type('typing now...'); await L.sleep(1500);
 out.typing=await page.evaluate(()=>/typing/i.test(document.body.innerText)?document.body.innerText.match(/.{0,30}typing.{0,30}/i)[0]:null); await page.screenshot({path:`${DIR}/d-typing.png`});
 await bp.page.keyboard.press('Control+A'); await bp.page.keyboard.press('Delete');
 // delete
 r=await j(await ctxs.bob.request.delete(`${api}/items/${id}?nonce=dd${T}`)); out.delStatus=r.status; await L.sleep(2500);
 out.delete_after=await page.evaluate((id)=>{const n=document.querySelector(`[data-message-id="${id}"]`);return n?n.innerText.replace(/\n+/g,'|').slice(0,100):null},id); await page.screenshot({path:`${DIR}/d-deleted.png`});
 // delete a plain message without replies
 const P=`par-D-plain-${T}`; r=await j(await ctxs.bob.request.post(api,{data:{content:P,nonce:`dp${T}`}})); const pid=r.body.id; await wait(async()=>(await info(P)).length>0);
 await j(await ctxs.bob.request.delete(`${api}/items/${pid}?nonce=dpd${T}`)); out.plain_delete_gone_ms=await wait(async()=>(await info(P)).length===0);
 // scrolled-up: not yanked
 await page.mouse.move(800,450); await page.mouse.wheel(0,-1500); await L.sleep(800); const g0=await gap();
 await j(await ctxs.bob.request.post(api,{data:{content:`par-D-while-up-${T}`,nonce:`du${T}`}})); await L.sleep(2500); const g1=await gap(); out.scrolledUp={gapBefore:g0,gapAfter:g1};
 await page.screenshot({path:`${DIR}/d-scrolled-up.png`});
 // jump to latest and re-pin
 await page.getByRole('button',{name:/scroll to bottom/i}).first().click().catch(()=>{}); await L.sleep(2000); out.afterJumpGap=await gap();
 await j(await ctxs.bob.request.post(api,{data:{content:`par-D-after-jump-${T}`,nonce:`dj${T}`}})); await L.sleep(2500); out.afterJumpNewGap=await gap(); out.afterJumpShown=(await info(`par-D-after-jump-${T}`)).length; await page.screenshot({path:`${DIR}/d-after-jump-pinned.png`});
 console.log(JSON.stringify(out,null,1)); fs.writeFileSync(DIR+'/d.json',JSON.stringify(out,null,1)); dumpIssues('d'); await browser.close();})().catch(e=>{console.error(e);console.log(JSON.stringify(out));process.exit(1)});
