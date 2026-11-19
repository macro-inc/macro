const {L,setup,openPage,DIR,dumpIssues}=require('./common.cjs'); const fs=require('fs'); const ch=L.ENV.channels.freshness;
const out={}; const T=Date.now();
(async()=>{ const {browser,ctxs}=await setup(); const {page}=await openPage(ctxs.alice,`${L.BASE}/app/channels/${ch}`); await L.sleep(4000);
 const rowsWith=(page,t)=>page.evaluate((t)=>[...document.querySelectorAll('[data-channel-scroll] [data-message-id]')].filter(n=>(n.textContent||'').includes(t)).map(n=>({id:n.getAttribute('data-message-id'),t:n.innerText.replace(/\n+/g,'|').slice(0,200)})),t);
 const ed=page.locator('[data-markdown-editable]').last();
 const A=`par-A-${T}`, A2=`par-A-edited-${T}`, B=`par-B-del-${T}`, R=`par-reply-${T}`;
 // 1 send
 await ed.click(); await page.keyboard.type(A); const t0=Date.now(); await page.keyboard.press('Enter');
 const at=await L.waitFor(async()=>(await rowsWith(page,A)).length>0?Date.now():null,{timeout:10000,interval:5}); out.send_appearMs=at-t0;
 const cnts=[]; for(let i=0;i<8;i++){await L.sleep(400);cnts.push((await rowsWith(page,A)).length);} out.send_rowCounts=cnts;
 const idA=(await rowsWith(page,A))[0].id; out.idA=idA; await page.screenshot({path:`${DIR}/c-sent.png`});
 const row=()=>page.locator(`[data-message-id="${idA}"]`).first();
 const act=async(name)=>{ await row().hover(); await L.sleep(300); await row().locator(`[data-message-action="${name}"]`).first().click(); };
 // 2 edit
 await act('edit'); await L.sleep(600);
 await page.keyboard.press('Control+A'); await page.keyboard.type(A2); await page.keyboard.press('Enter'); await L.sleep(2000);
 let r=await rowsWith(page,A2); out.edit={rows:r.length,text:r[0]&&r[0].t,editedMarker:r[0]&&/edited/.test(r[0].t),oldTextRows:(await rowsWith(page,A+'\n')).length}; await page.screenshot({path:`${DIR}/c-edited.png`});
 // 3 react add
 await act('react-quick'); // first quick = ❤️
 await L.sleep(1500); const chips=()=>row().evaluate(n=>[...n.querySelectorAll('[data-message-reaction-chip]')].map(c=>c.innerText.replace(/\s+/g,' ')));
 out.react_after_add=await chips(); await page.screenshot({path:`${DIR}/c-react.png`});
 // remove: click the chip
 await row().locator('[data-message-reaction-chip]').first().click(); await L.sleep(1500); out.react_after_remove=await chips();
 // add again to verify persistence after reload
 await act('react-quick'); await L.sleep(1200); out.react_final=await chips();
 // 4 thread reply
 await act('reply'); await L.sleep(1000);
 await page.screenshot({path:`${DIR}/c-reply-open.png`});
 await page.keyboard.type(R); await page.keyboard.press('Enter'); await L.sleep(2500);
 out.reply_row_count=(await rowsWith(page,R)).length; out.root_after_reply=(await rowsWith(page,A2))[0]?.t; await page.screenshot({path:`${DIR}/c-replied.png`});
 // 5 delete second message
 await page.keyboard.press('Escape');
 await ed.click(); await page.keyboard.type(B); await page.keyboard.press('Enter'); await L.sleep(2000);
 const idB=(await rowsWith(page,B))[0].id; out.idB=idB;
 await page.locator(`[data-message-id="${idB}"]`).first().hover(); await L.sleep(300); await page.locator(`[data-message-id="${idB}"] [data-message-action="delete"]`).first().click(); await L.sleep(800);
 await page.screenshot({path:`${DIR}/c-delete-confirm.png`});
 const conf=page.getByRole('button',{name:/^(delete|confirm|yes)/i}); if(await conf.count()){ await conf.last().click(); }
 await L.sleep(2000); out.deleted_rows_with_text=(await rowsWith(page,B)).length; out.deleted_row_exists=await page.evaluate((id)=>{const n=document.querySelector(`[data-message-id="${id}"]`);return n?n.innerText.replace(/\n+/g,'|').slice(0,100):null},idB); await page.screenshot({path:`${DIR}/c-deleted.png`});
 // 6 reload
 await page.reload(); await page.waitForSelector('[data-channel-scroll] [data-message-id]',{timeout:60000}); await L.sleep(4000);
 const ra=await rowsWith(page,A2); out.reload={A2rows:ra.length,A2text:ra[0]&&ra[0].t,Aold:(await rowsWith(page,A)).filter(x=>!x.t.includes('edited-')).length,Brows:(await rowsWith(page,B)).length,Bnode:await page.evaluate((id)=>{const n=document.querySelector(`[data-message-id="${id}"]`);return n?n.innerText.slice(0,60):null},idB),Rrows:(await rowsWith(page,R)).length};
 await page.screenshot({path:`${DIR}/c-reloaded.png`});
 console.log(JSON.stringify(out,null,1)); fs.writeFileSync(DIR+'/c.json',JSON.stringify(out,null,1)); dumpIssues('c'); await browser.close();})().catch(e=>{console.error(e);console.log(JSON.stringify(out));process.exit(1)});
