const L = require(__dirname + '/lib.cjs');
(async () => {
  const browser = await L.launch();
  const state = await L.authState(browser, 'alice@seed.macro.local');
  const ctx = await L.newContext(browser, { storageState: state });
  const page = await ctx.newPage(); const logs = []; const bad = [];
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 400))); page.on('crash', () => logs.push('CRASH'));
  page.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().slice(0, 120)); });
  await page.goto(`${L.BASE}/app/channels/${L.ENV.channels.freshness}`).catch((e) => logs.push('goto ' + e));
  for (let k = 0; k < 8; k++) { await L.sleep(5000); const n = await page.evaluate(() => document.querySelectorAll('[data-channel-scroll] [data-message-id]').length).catch((e) => 'ERR ' + String(e).slice(0, 100)); console.log(k, n); if (n > 0 || String(n).startsWith('ERR')) break; }
  await page.screenshot({ path: __dirname + '/tmp/dbg-open.png' }).catch(() => {});
  console.log(bad.slice(0, 10).join('\n')); console.log(logs.slice(0, 15).join('\n'));
  await browser.close();
})().catch((e) => { console.error(String(e).slice(0, 500)); process.exit(1); });
