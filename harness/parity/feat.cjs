const {L,setup,openPage,DIR}=require('./common.cjs'); const ch=L.ENV.channels.large;
const T={att:'01a1bb72-4d7a-7556-a841-df0838c9cb9f',delrep:'01a1b670-3b62-7388-ab72-80757cb1bba5',mention:'01a1cada-9cc6-7e26-b297-c98ac17f4341'};
(async()=>{ const {browser,ctxs}=await setup(); for(const [k,id] of Object.entries(T)){
 const {page}=await openPage(ctxs.alice,`${L.BASE}/app/channels/${ch}?channel_message_id=${id}`,`[data-message-id="${id}"]`); await L.sleep(4000);
 const info=await page.evaluate((id)=>{const n=document.querySelector(`[data-message-id="${id}"]`);return {text:n.innerText.replace(/\n+/g,' | ').slice(0,300),imgs:n.querySelectorAll('img').length}},id); console.log(k,JSON.stringify(info));
 await page.screenshot({path:`${DIR}/feat-${k}.png`}); await page.close(); }
 await browser.close();})();
