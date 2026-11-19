const pw = require('/home/teo/.herdr/worktrees/macro/synoet-channels-local-sync/node_modules/playwright');
const tls = require('node:tls'); const crypto = require('node:crypto');
const spkiList = () => new Promise((resolve) => { const s = tls.connect({ host: 'localhost', port: 31009, rejectUnauthorized: false, servername: 'localhost' }, () => { const out = []; let c = s.getPeerX509Certificate(); for (let i = 0; c && i < 6; i++) { out.push(crypto.createHash('sha256').update(c.publicKey.export({ type: 'spki', format: 'der' })).digest('base64')); const n = c.issuerCertificate; if (!n || n === c || n.fingerprint256 === c.fingerprint256) break; c = n; } s.end(); resolve(out); }); s.on('error', () => resolve([])); });
(async () => {
  const spki = await spkiList(); console.log('spki', spki.length);
  const browser = await pw.chromium.launch({ headless: true, args: [`--ignore-certificate-errors-spki-list=${spki.join(',')}`] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: !spki.length });
  const page = await ctx.newPage(); const logs = [];
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 200)); });
  page.on('requestfailed', (r) => logs.push('FAILED ' + r.url().slice(0, 120) + ' ' + (r.failure() || {}).errorText));
  page.on('response', (r) => { if (r.status() >= 400) logs.push(r.status() + ' ' + r.url().slice(0, 120)); });
  await page.goto('https://localhost:31009/app/login?email=' + encodeURIComponent(process.argv[2] || 'alice@seed.macro.local'));
  await page.waitForTimeout(25000);
  console.log('url', page.url()); console.log((await page.locator('body').innerText()).slice(0, 300).replace(/\n+/g, ' | '));
  console.log([...new Set(logs)].slice(0, 15).join('\n'));
  await page.screenshot({ path: '/home/teo/.cache/channels-perf-b/results/dbg-login.png' }); await browser.close();
})();
