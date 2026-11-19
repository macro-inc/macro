const {L,setup,openPage,DIR,dumpIssues}=require('./common.cjs'); const fs=require('fs'); const ch=L.ENV.channels.large;
const all=require('./large-all.json').map(e=>e.message); const byId=new Map(all.map((m,i)=>[m.id,{i,m}]));
(async()=>{ const {browser,ctxs}=await setup(); const {page}=await openPage(ctxs.alice,`${L.BASE}/app/channels/${ch}`); await L.sleep(3000);
 const rows=new Map(); // data-index -> {kind,id,text,flags}
 const collect=async()=>{ const r=await page.evaluate(()=>[...document.querySelectorAll('[data-channel-scroll] [data-index]')].map(e=>{const m=e.querySelector('[data-message-id]')||(e.hasAttribute('data-message-id')?e:null);return {ix:+e.getAttribute('data-index'),id:m&&m.getAttribute('data-message-id'),text:e.innerText.replace(/\n+/g,' | ').slice(0,200),edited:/\(edited\)/.test(e.innerText),react:e.querySelectorAll('[data-message-reaction-chip]').length,att:e.querySelectorAll('img,video,[data-attachment]').length,ment:e.querySelectorAll('[data-mention],.mention,m-user-mention').length,replies:/\d+ repl/.test(e.innerText)}}));
  for(const x of r) rows.set(x.ix,x); };
 for(let i=0;i<230;i++){ await page.mouse.move(800,450); await page.mouse.wheel(0,-500); await L.sleep(110); await collect(); }
 await L.sleep(1500); await collect();
 await page.screenshot({path:DIR+'/b-deep.png'});
 const list=[...rows.values()].sort((a,b)=>a.ix-b.ix);
 const msgs=list.filter(x=>x.id); const others=list.filter(x=>!x.id);
 const idxs=list.map(x=>x.ix); let ixGaps=0; for(let k=1;k<idxs.length;k++) if(idxs[k]!==idxs[k-1]+1) ixGaps++;
 const tix=msgs.map(x=>byId.get(x.id)?.i); const unknown=msgs.filter(x=>!byId.has(x.id)).length;
 // msgs sorted by data-index ascending = oldest first => truth index descending
 let order=0,gap=0; for(let k=1;k<tix.length;k++){ if(tix[k]===undefined||tix[k-1]===undefined)continue; if(tix[k]>tix[k-1]) order++; else if(tix[k-1]-tix[k]!==1) gap++; }
 console.log(JSON.stringify({rows:list.length,msgs:msgs.length,others:others.length,ixGaps,unknown,orderViolations:order,truthGaps:gap,truthMin:Math.min(...tix.filter(x=>x!==undefined)),truthMax:Math.max(...tix.filter(x=>x!==undefined))}));
 console.log('OTHER SAMPLES',JSON.stringify(others.slice(0,12).map(o=>o.text)));
 // dividers: text matches date; check against neighbours
 const dayOf=(iso)=>new Date(iso).toDateString();
 let bad=[],checked=0;
 for(const o of others){ const next=list.find(x=>x.ix>o.ix&&x.id); const prev=[...list].reverse().find(x=>x.ix<o.ix&&x.id); if(!next)continue; const nm=byId.get(next.id)?.m; if(!nm)continue; const d=new Date(nm.created_at); checked++;
   const txt=o.text; const mon=d.toLocaleString('en-US',{month:'long'}), mons=d.toLocaleString('en-US',{month:'short'}); const dd=String(d.getDate());
   const ok=(txt.includes(mon)||txt.includes(mons))&&new RegExp('\\b'+dd+'\\b').test(txt)||/Today|Yesterday/.test(txt);
   const pm=prev&&byId.get(prev.id)?.m; const diffDay=pm?dayOf(pm.created_at)!==dayOf(nm.created_at):true;
   if(!ok||!diffDay) bad.push({txt,next:nm.created_at,prev:pm&&pm.created_at,ok,diffDay}); }
 // missing dividers: consecutive messages on different days w/o divider between
 let missing=0; for(let k=1;k<msgs.length;k++){ if(msgs[k].ix!==msgs[k-1].ix+1)continue; const a=byId.get(msgs[k-1].id)?.m,b=byId.get(msgs[k].id)?.m; if(a&&b&&dayOf(a.created_at)!==dayOf(b.created_at)) missing++; }
 console.log(JSON.stringify({dividersChecked:checked,badDividers:bad.slice(0,5),nBad:bad.length,adjacentDifferentDayNoDivider:missing}));
 const cnt=(f)=>msgs.filter(f).length; console.log(JSON.stringify({edited:cnt(x=>x.edited),react:cnt(x=>x.react),att:cnt(x=>x.att>1),replies:cnt(x=>x.replies)}));
 const truthEdited=msgs.filter(x=>byId.get(x.id)?.m.edited_at).length, truthReact=msgs.filter(x=>byId.get(x.id)?.m.reactions.length).length, truthDeleted=msgs.filter(x=>byId.get(x.id)?.m.deleted_at).length, truthAtt=msgs.filter(x=>byId.get(x.id)?.m.attachments.length).length, truthThr=msgs.filter(x=>byId.get(x.id)?.m.thread?.reply_count).length;
 console.log(JSON.stringify({truthEdited,truthReact,truthDeleted,truthAtt,truthThr}));
 const mism=msgs.filter(x=>{const m=byId.get(x.id)?.m;return m&&((!!m.edited_at)!==x.edited||(m.reactions.length>0)!==(x.react>0))}).slice(0,5); console.log('mism',JSON.stringify(mism.map(x=>[x.id,x.edited,x.react,byId.get(x.id).m.edited_at,byId.get(x.id).m.reactions.length])));
 dumpIssues('b'); fs.writeFileSync(DIR+'/b-rows.json',JSON.stringify(list.slice(0,400))); await browser.close();})();
