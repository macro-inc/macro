#!/usr/bin/env bash
# render per-step stills of mobile.html in one format: ./mstills.sh 916 out_dir step...
f=$1; out=$2; shift 2
node -e "
import('/opt/node22/lib/node_modules/playwright/index.mjs').then(async({chromium})=>{
const [W,H]={916:[1080,1920],11:[1440,1440],169:[1920,1080]}[$f];
const b=await chromium.launch({args:['--force-color-profile=srgb','--font-render-hinting=none','--disable-lcd-text']});const p=await b.newPage({viewport:{width:W,height:H}});
p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto('file://'+process.cwd()+'/mobile.html?render=1&fmt=$f');await p.evaluate(()=>window.ready);
const fs=await import('node:fs');fs.mkdirSync('$out',{recursive:true});
for(const s of '$*'.split(' ').map(Number)){const t=await p.evaluate(x=>window.B(x),s);await p.evaluate(tt=>window.seek(tt),t);await p.screenshot({path:'$out/s'+s.toFixed(2).padStart(5,'0')+'.png'});}
await b.close()})"
