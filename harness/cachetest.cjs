const L = require('./lib.cjs');
(async () => {
  const b = await L.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: false });
  const page = await ctx.newPage(); const rec = await L.recorder(page);
  await L.login(page, 'alice@seed.macro.local'); await L.sleep(4000);
  const t = Date.now(); await page.reload(); await page.waitForLoadState('load'); await L.sleep(3000);
  console.log('reload static', JSON.stringify(L.staticSummary(rec.requests(), t)));
  await b.close();
})().catch((e) => { console.error(String(e).slice(0, 400)); process.exit(1); });
