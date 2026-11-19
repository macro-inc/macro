const L = require('./lib.cjs'); const fs = require('fs'); const path = require('path');
const FX = JSON.parse(fs.readFileSync(path.join(L.HERE, 'fixture.json'), 'utf8'));
(async () => {
  const settle = Number(process.argv[2] || 25000); const c = FX.channels.medium; const lobby = L.ENV.channels.lobby;
  const browser = await L.launch(); const state = await L.authState(browser, 'alice@seed.macro.local');
  const ctx = await L.newContext(browser, { storageState: state }); const page = await ctx.newPage();
  const logs = []; page.on('console', (m) => { const t = m.text(); if (/channel|cache|offline|fail|error/i.test(t)) logs.push(`${m.type()}: ${t.slice(0, 260)}`); });
  await page.goto(`${L.BASE}/app/channels/${c.id}`); await page.waitForSelector('[data-channel-scroll] [data-message-id]', { timeout: 90000 }); await L.sleep(8000);
  const t0 = Date.now(); await page.goto(`${L.BASE}/app/channels/${lobby}`); await page.waitForSelector('[data-channel-scroll] [data-message-id]', { timeout: 90000 });
  await L.sleep(Math.max(0, settle - (Date.now() - t0)));
  logs.length = 0; await ctx.setOffline(true);
  const row = page.locator(`[role="treeitem"][id$="-channel:${c.id}"]`).first(); await row.scrollIntoViewIfNeeded(); const tc = Date.now(); await row.click();
  for (let i = 0; i < 10; i++) {
    await L.sleep(1500);
    const st = await page.evaluate(() => ({ url: location.pathname, rows: document.querySelectorAll('[data-channel-scroll] [data-message-id]').length, scroll: !!document.querySelector('[data-channel-scroll]') }));
    console.log(Date.now() - tc, JSON.stringify(st)); if (st.rows > 0 && st.url.includes(c.id)) break;
  }
  await page.screenshot({ path: path.join(L.OUT, 'offline-dbg.png') });
  console.log(logs.slice(0, 25).join('\n')); await browser.close();
})();
