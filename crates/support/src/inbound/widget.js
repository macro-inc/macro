(() => {
  const script = document.currentScript;
  const key = script?.dataset.macroSupport;
  if (!key || document.getElementById('macro-support-widget')) return;
  const base = new URL(script.src).href.replace(/\/widget\.js(?:\?.*)?$/, '');
  const host = document.createElement('div');
  host.id = 'macro-support-widget';
  document.body.append(host);
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    :host{font:14px system-ui;color:#24232a}*{box-sizing:border-box}
    button,input,textarea{font:inherit}button{cursor:pointer;border:0;border-radius:9px;background:#6556d8;color:white;padding:11px 16px}
    .launcher{position:fixed;bottom:24px;right:24px;z-index:2147483646;box-shadow:0 5px 25px #0003}
    .panel{position:fixed;bottom:82px;right:24px;width:350px;max-width:calc(100vw - 32px);height:490px;max-height:calc(100dvh - 110px);background:white;border-radius:16px;box-shadow:0 8px 40px #0003;z-index:2147483646;display:flex;flex-direction:column;overflow:hidden}
    .panel[hidden]{display:none}header{padding:20px;background:#6556d8;color:white}header strong{display:block;font-size:17px}
    .log{flex:1;overflow:auto;padding:18px;white-space:pre-wrap}.message{padding:10px 12px;margin:8px 0;border-radius:10px;background:#f2f1f8}.customer{background:#e7e2ff;margin-left:30px}
    form{padding:14px;border-top:1px solid #eee;display:grid;gap:8px}input,textarea{border:1px solid #ddd;border-radius:7px;padding:10px;width:100%}textarea{resize:none}small{color:#777;text-align:center;padding-bottom:10px}.error{color:#b52642}
  </style><button class="launcher" aria-expanded="false">Chat with us</button><section class="panel" aria-label="Customer support" hidden><header><strong>Support</strong><span>We’re here to help</span></header><div class="log" role="log" aria-live="polite"></div><form><input name="name" aria-label="Your name" placeholder="Your name" required maxlength="200"><input name="email" aria-label="Email address" type="email" placeholder="Email address" required><textarea name="message" aria-label="Message" placeholder="How can we help?" required maxlength="32000"></textarea><div class="error" role="alert"></div><button type="submit">Send message</button></form><small>Powered by Macro</small></section>`;
  const select = (s) => root.querySelector(s);
  const store = `macro-support:${key}`;
  let token;try { token = localStorage.getItem(store); } catch {}
  let pending;
  let busy = false;
  const uuid7 = () => {const b=crypto.getRandomValues(new Uint8Array(16));let t=Date.now();for(let i=5;i>=0;i--){b[i]=t%256;t=Math.floor(t/256)}b[6]=(b[6]&15)|112;b[8]=(b[8]&63)|128;const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
  const identity = () => {select('[name=name]').hidden=!!token;select('[name=email]').hidden=!!token;select('[name=name]').required=!token;select('[name=email]').required=!token;};
  const request = async (path, body) => {
    const response = await fetch(`${base}${path}`, {method:body?'POST':'GET',credentials:'omit',headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});
    if (!response.ok) {if(response.status===403&&token){token=null;try{localStorage.removeItem(store)}catch{}identity();}throw new Error('Unable to connect. Please try again.');}
    return response.status===204?null:response.json();
  };
  const refresh = async () => {
    if(!token||select('.panel').hidden)return;
    try{const data=await request('/visitor/messages');select('.log').replaceChildren(...data.messages.map(m=>{const el=document.createElement('div');el.className=`message ${m.author_kind==='customer'?'customer':''}`;el.textContent=m.content;return el;}));select('.log').scrollTop=select('.log').scrollHeight;}catch(e){select('.error').textContent=e.message;}
  };
  select('.launcher').onclick=async()=>{
    const panel=select('.panel');panel.hidden=!panel.hidden;select('.launcher').setAttribute('aria-expanded',String(!panel.hidden));
    if(!panel.hidden){try{const config=await request(`/widget/${key}`);select('header strong').textContent=config.name;select('header span').textContent=config.welcome;identity();await refresh();select('[name=message]').focus();}catch(e){select('.error').textContent=e.message;}}
  };
  select('form').onsubmit=async(event)=>{
    event.preventDefault();if(busy)return;busy=true;select('button[type=submit]').disabled=true;select('.error').textContent='';
    const content=select('[name=message]').value;
    try{if(!token){const result=await request(`/widget/${key}`,{name:select('[name=name]').value,email:select('[name=email]').value,subject:content.slice(0,120),content});token=result.token;try{localStorage.setItem(store,token)}catch{}identity();}else{if(!pending||pending.content!==content)pending={id:uuid7(),content,public:true,mentions:[]};await request('/visitor/messages',pending);pending=null;}
      select('[name=message]').value='';await refresh();
    }catch(e){select('.error').textContent=e.message;}finally{busy=false;select('button[type=submit]').disabled=false;}
  };
  identity();setInterval(refresh,5000);
})();
