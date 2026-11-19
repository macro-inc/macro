const {L,setup,openPage,DIR,dumpIssues}=require('./common.cjs'); const fs=require('fs'); const ch=L.ENV.channels.large;
const all=require('./large-all.json').map(e=>e.message); const byId=new Map(all.map((m,i)=>[m.id,{i,m}]));
const dayOf=(iso)=>new Date(iso).toDateString();
(async()=>{ const {browser,ctxs}=await setup(); const {page}=await openPage(ctxs.alice,`${L.BASE}/app/channels/${ch}`); await L.sleep(3000);
 const seen=new Map(); let missingDiv=0,spurious=0,pairs=0; const flagTexts=new Set(); const feats={edited:new Set(),react:new Set(),att:new Set(),replyRows:new Set(),mention:new Set(),tomb:new Set()};
 const snap=async()=>{ const toks=await page.evaluate(()=>{const s=document.querySelector('[data-channel-scroll]'); const out=[]; const w=document.createTreeWalker(s,NodeFilter.SHOW_ELEMENT); let n;
   while(n=w.nextNode()){ if(n.hasAttribute('data-message-id')&&n.hasAttribute('data-message')||(n.hasAttribute('data-message-id')&&!n.closest('[data-message-id]:not(:scope)'))){ if(out.length&&out[out.length-1].id===n.getAttribute('data-message-id'))continue; const t=n.innerText||''; out.push({id:n.getAttribute('data-message-id'),edited:/\(edited\)/.test(t),react:n.querySelectorAll('[data-message-reaction-chip]').length,img:n.querySelectorAll('img').length,mention:/@\w/.test(t),tomb:/deleted/i.test(t)&&t.length<200,rep:/\d+ more repl|\d+ repl/.test(t)}); }
     else if(n.children.length===0){ const t=(n.textContent||'').trim(); if(t.length<40&&/^((Today|Yesterday|(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day|[A-Z][a-z]{2,8} \d{1,2}(, \d{4})?)( - New)?|New)$/.test(t)&&!n.closest('[data-message-id]')) out.push({div:t}); } }
   return out;});
  for(let k=0;k<toks.length;k++){ const t=toks[k]; if(t.id){ seen.set(t.id,t); const m=byId.get(t.id)?.m; if(m&&t.edited!==!!m.edited_at&&t.edited)feats.edited.add(t.id); if(t.edited)feats.edited.add(t.id); if(t.react)feats.react.add(t.id); if(t.img>1)feats.att.add(t.id); if(t.tomb)feats.tomb.add(t.id); if(t.rep)feats.replyRows.add(t.id);} else flagTexts.add(t.div); }
  for(let k=1;k<toks.length;k++){ const a=toks[k-1],b=toks[k]; if(a.id&&b.id){ const ma=byId.get(a.id)?.m,mb=byId.get(b.id)?.m; if(ma&&mb){pairs++; // dom order: a older than b? check
        if(dayOf(ma.created_at)!==dayOf(mb.created_at)) missingDiv++; } }
      if(a.id&&b.div&&toks[k+1]&&toks[k+1].id){ const ma=byId.get(a.id)?.m,mb=byId.get(toks[k+1].id)?.m; if(ma&&mb&&dayOf(ma.created_at)===dayOf(mb.created_at)&&!/New/.test(b.div)) spurious++; } } };
 for(let i=0;i<260;i++){ await page.mouse.move(800,450); await page.mouse.wheel(0,-500); await L.sleep(100); await snap(); }
 await L.sleep(1500); await snap(); await page.screenshot({path:DIR+'/b-deep.png'});
 const ids=[...seen.keys()]; const tix=ids.map(i=>byId.get(i)?.i).filter(x=>x!==undefined).sort((a,b)=>a-b);
 let gaps=0; for(let k=1;k<tix.length;k++) if(tix[k]!==tix[k-1]+1) gaps++;
 const res={uniqueMsgs:ids.length,unknown:ids.filter(i=>!byId.has(i)).length,truthRange:[tix[0],tix[tix.length-1]],gaps,pairs,missingDividerBetweenDifferentDays:missingDiv,spuriousDividerSameDay:spurious,dividerTexts:[...flagTexts].slice(0,12)};
 const ex=(f)=>[...seen.values()].filter(f).length;
 res.features={editedShown:feats.edited.size,truthEditedInRange:[...seen.keys()].filter(i=>byId.get(i)?.m.edited_at).length,reactShown:feats.react.size,truthReactInRange:[...seen.keys()].filter(i=>byId.get(i)?.m.reactions.length).length,attShown:feats.att.size,truthAtt:[...seen.keys()].filter(i=>byId.get(i)?.m.attachments.length).length,threadRowsShown:feats.replyRows.size,truthThreads:[...seen.keys()].filter(i=>byId.get(i)?.m.thread?.reply_count).length,tombShown:feats.tomb.size};
 console.log(JSON.stringify(res)); dumpIssues('b'); await browser.close();})();
