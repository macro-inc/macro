// Exploration only: sign in two probe users, create a channel with history, dump the channel DOM hooks.
const pw = require('/home/teo/.herdr/worktrees/macro/synoet-channels-e2e-base/node_modules/playwright');
const B = process.argv[2];
async function signIn(email) {
  const api = await pw.request.newContext({ baseURL: B, ignoreHTTPSErrors: true });
  const { code } = await (await api.post('/auth/login/passwordless', { data: { email, redirect_uri: B + '/app' } })).json();
  await api.get(`/auth/oauth/passwordless/${code}?email=${encodeURIComponent(email)}`, { maxRedirects: 0 });
  await api.patch('/auth/user/tutorial', { data: { tutorialComplete: true } });
  return api;
}
(async () => {
  const a = await signIn('probe-a@channels-e2e.test');
  const b = await signIn('probe-b@channels-e2e.test');
  const made = await (await a.post('/dss/channels', { data: { channel_type: 'private', name: 'probe-' + Date.now(), participants: ['macro|probe-b@channels-e2e.test'] } })).json();
  const ids = [];
  for (let i = 1; i <= 130; i++) {
    const r = await (i % 2 ? a : b).post(`/dss/messages/channel/${made.id}`, { data: { content: `probe message ${i}` } });
    if (!r.ok()) { console.log('post failed', r.status(), await r.text()); break; }
    ids.push((await r.json()).id);
  }
  for (let i = 1; i <= 3; i++) await b.post(`/dss/messages/channel/${made.id}`, { data: { content: `reply ${i}`, thread_id: ids[127] } });
  await b.post(`/dss/messages/channel/${made.id}/items/${ids[128]}/reactions`, { data: { emoji: '👍', add: true } });
  const browser = await pw.chromium.launch({ headless: true });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, storageState: await a.storageState(), viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: 'login', value: 'true', url: B }]);
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log("console.error", m.text().slice(0, 200)); });
  page.on("requestfailed", (r) => console.log("requestfailed", r.url().slice(0, 120), r.failure()?.errorText));
  page.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 200)));
  await page.goto(`${B}/app/channels/${made.id}`);
  await page.waitForSelector('[data-message-id]', { timeout: 60000 }); await page.waitForTimeout(4000); await page.screenshot({ path: "/home/teo/.cache/channels-e2e/tmp/explore.png" }); console.log("url", page.url());
  await page.waitForTimeout(3000);
  console.log('url', page.url());
  const dump = await page.evaluate(() => {
    const out = [];
    const seen = new Set();
    for (const el of document.querySelectorAll('*')) {
      const attrs = [...el.attributes].filter((x) => x.name.startsWith('data-') || x.name === 'role' || x.name === 'aria-label' || x.name === 'title' || x.name === 'placeholder').map((x) => `${x.name}=${String(x.value).slice(0, 50)}`);
      if (!attrs.length) continue;
      const key = el.tagName + ' ' + attrs.map((s) => s.replace(/=[0-9a-f-]{20,}.*$/, '=<id>').replace(/=\d+$/, '=<n>')).join(' ');
      if (seen.has(key)) continue; seen.add(key); out.push(key);
    }
    return out;
  });
  console.log(dump.join('\n'));
  const last = page.locator('[data-message-id]').last();
  console.log('LAST ROW HTML', (await last.evaluate((e) => e.outerHTML)).slice(0, 2500));
  await page.screenshot({ path: '/home/teo/.cache/channels-e2e/tmp/explore.png' });
  await browser.close();
  console.log(JSON.stringify({ channel: made.id }));
})().catch((e) => { console.error(e); process.exit(1); });
