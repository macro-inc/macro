const L = require(__dirname + '/lib.cjs');
const ch = L.ENV.channels.freshness; const mode = process.argv[2] || 'block';
(async () => {
  const browser = await L.launch();
  const state = await L.authState(browser, 'alice@seed.macro.local');
  const ctx = await L.newContext(browser, { storageState: state });
  const page = await ctx.newPage();
  const logs = []; page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 400))); page.on('crash', () => logs.push('CRASH at ' + Date.now()));
  const url = `${L.BASE}/app/channels/${ch}`;
  await page.goto(url); await page.waitForSelector('[data-channel-scroll] [data-message-id]', { timeout: 90000 }); await L.sleep(5000);
  const opOf = (pd) => { try { return JSON.parse(pd || '{}').operationName; } catch (e) { return undefined; } };
  let n = 0; const ops = [];
  const fn = (route) => { const rq = route.request(); const op = rq.method() === 'POST' ? opOf(rq.postData()) : undefined; if (op) ops.push(op); if (op === 'SendChannelMessage' && mode !== 'pass') { n++; return route.abort('internetdisconnected'); } return route.continue(); };
  if (mode !== 'noroute') await ctx.route('**/*', fn);
  const m = `dbg-${Date.now()}`;
  await page.locator('[data-markdown-editable]').last().click(); await page.keyboard.type(m); await page.keyboard.press('Enter');
  await L.sleep(4000); console.log('before reload attempts', n, 'logs', logs.length);
  logs.length = 0; ops.length = 0; const t0 = Date.now();
  await page.reload().catch((e) => console.log('reload err', String(e).slice(0, 200)));
  for (let k = 0; k < 30; k++) { await L.sleep(3000); const alive = await Promise.race([page.evaluate((t) => document.querySelectorAll('[data-channel-scroll] [data-message-id]').length + ' has:' + [...document.querySelectorAll('[data-channel-scroll] [data-message-id]')].filter((n) => (n.textContent||'').includes(t)).length, m).catch((e) => 'ERR ' + String(e).slice(0, 80)), L.sleep(2000).then(() => 'HUNG')]); console.log(Date.now() - t0, 'rows', alive, 'attempts', n, 'ops', ops.length); if (String(alive).startsWith('ERR')) break; }
  { const c2 = await L.newContext(browser, { storageState: state }); const p2 = await c2.newPage(); await p2.goto(url); await p2.waitForSelector('[data-channel-scroll] [data-message-id]', { timeout: 90000 }); await L.sleep(4000); console.log('server has', await p2.evaluate((t) => [...document.querySelectorAll('[data-channel-scroll] [data-message-id]')].filter((n) => (n.textContent||'').includes(t)).length, m)); await c2.close(); }
  console.log(JSON.stringify(ops.reduce((a, o) => (a[o] = (a[o] || 0) + 1, a), {})));
  console.log(logs.slice(0, 25).join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
