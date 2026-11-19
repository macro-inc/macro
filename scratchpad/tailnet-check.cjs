const pw = require('/home/teo/.herdr/worktrees/macro/synoet-channels-local-sync/node_modules/playwright');
const fs = require('node:fs');
const APP = 'https://solaris.tail913c08.ts.net:31049/app';
const FRESH = '5eed92f0-15d3-83f5-a505-41d4adcf67c2';
const OUT = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function login(page, email) {
  await page.goto(`${APP}/login?email=${encodeURIComponent(email)}`);
  await page.waitForURL((u) => !/\/(login|welcome)/.test(u.pathname), { timeout: 120000 });
  for (const name of ['Get started', 'Continue', 'Skip for now', 'Continue with Free']) {
    const b = page.getByRole('button', { name, exact: true });
    if (await b.first().isVisible().catch(() => false)) { await b.first().click(); await page.waitForTimeout(1000); }
  }
}
function watch(page, who, log) {
  page.on('websocket', (ws) => { log.push(`${who} ws open ${ws.url().slice(0, 90)}`); ws.on('close', () => log.push(`${who} ws close ${ws.url().slice(0, 60)}`)); });
  page.on('response', (r) => { const u = r.url(); if (/graphql/.test(u) && !log.some((l) => l.startsWith(`${who} gql`))) log.push(`${who} gql ${r.status()} ${u.slice(0, 100)}`); if (r.status() >= 400) log.push(`${who} ${r.status()} ${u.slice(0, 110)}`); });
  page.on('requestfailed', (r) => log.push(`${who} FAILED ${r.url().slice(0, 100)} ${(r.failure() || {}).errorText}`));
}
(async () => {
  const browser = await pw.chromium.launch({ headless: true });
  const log = [];
  const actx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const bctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const a = await actx.newPage(); watch(a, 'alice', log);
  const b = await bctx.newPage(); watch(b, 'bob', log);
  await login(a, 'alice@seed.macro.local'); console.log('alice signed in', a.url());
  await login(b, 'bob@seed.macro.local'); console.log('bob signed in', b.url());
  await a.goto(`${APP}/channels/${FRESH}`); await a.waitForSelector('[data-channel-scroll] [data-message-id]', { timeout: 90000 });
  await b.goto(`${APP}/channels/${FRESH}`); await b.waitForSelector('[data-channel-scroll] [data-message-id]', { timeout: 90000 });
  console.log('both have #freshness open'); await sleep(8000);
  const text = `tailnet check ${Date.now()}`;
  const editors = b.locator('[contenteditable="true"]');
  console.log('bob editors', await editors.count());
  await editors.last().click(); await b.keyboard.type(text); const t0 = Date.now(); await b.keyboard.press('Enter');
  await a.waitForFunction((t) => Array.from(document.querySelectorAll('[data-channel-scroll] [data-message-id]')).some((n) => (n.textContent || '').includes(t)), text, { timeout: 30000 });
  console.log(`alice saw bob's message after ${Date.now() - t0} ms: "${text}"`);
  await a.screenshot({ path: `${OUT}/tailnet-alice.png` }); await b.screenshot({ path: `${OUT}/tailnet-bob.png` });
  const cookies = await actx.cookies();
  fs.writeFileSync(`${OUT}/alice-cookie.txt`, 'Cookie: ' + cookies.map((c) => `${c.name}=${c.value}`).join('; ') + '\n', { mode: 0o600 });
  console.log([...new Set(log)].join('\n'));
  await browser.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
