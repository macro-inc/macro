const L = require('../lib.cjs');
const fs=require('fs');
const DIR='/home/teo/.cache/channels-perf-b/parity';
async function setup(emails=['alice@seed.macro.local']){
  const browser = await L.launch();
  const ctxs={};
  for (const e of emails){ ctxs[e.split('@')[0]] = await L.newContext(browser,{storageState: await L.authState(browser,e), insecure:true}); }
  return {browser, ctxs};
}
const j = async (r) => { const t = await r.text(); try { return { status: r.status(), body: JSON.parse(t) }; } catch { return { status: r.status(), body: t }; } };
async function openPage(ctx, url, sel='[data-channel-scroll] [data-message-id]', tries=3){
  const issues={console:[],failed:[],bad:[]};
  for(let i=0;i<tries;i++){
    const page=await ctx.newPage();
    attach(page,issues);
    try{ await page.goto(url,{timeout:60000}); await page.waitForSelector(sel,{timeout:45000}); return {page,issues}; }catch(e){ await page.close(); }
  }
  throw new Error('load failed '+url);
}
const ISS = (global.__iss = global.__iss || {console:new Map(),failed:new Map(),bad:new Map()});
function attach(page,issues){
  page.on('console',m=>{ if(m.type()==='error'){ const k=m.text().slice(0,300); ISS.console.set(k,(ISS.console.get(k)||0)+1);} });
  page.on('requestfailed',r=>{ const k=r.method()+' '+r.url().replace(/[0-9a-f-]{36}/g,':id').slice(0,160)+' '+(r.failure()||{}).errorText; ISS.failed.set(k,(ISS.failed.get(k)||0)+1); });
  page.on('response',async r=>{ if(r.status()>=400){ let op=''; try{op=JSON.parse(r.request().postData()||'{}').operationName||''}catch{} const k=r.status()+' '+r.request().method()+' '+r.url().replace(/[0-9a-f-]{36}/g,':id').slice(0,160)+' '+op; ISS.bad.set(k,(ISS.bad.get(k)||0)+1);} });
}
function dumpIssues(name){ fs.writeFileSync(DIR+'/issues-'+name+'.json',JSON.stringify({console:[...ISS.console],failed:[...ISS.failed],bad:[...ISS.bad]},null,1)); }
const rows = (page)=>page.evaluate(()=>[...document.querySelectorAll('[data-channel-scroll] [data-message-id]')].map(n=>({id:n.getAttribute('data-message-id'),top:Math.round(n.getBoundingClientRect().top),t:(n.textContent||'').slice(0,80),targeted:n.hasAttribute('data-targeted')})));
module.exports={L,setup,j,openPage,attach,dumpIssues,rows,DIR,ISS};
