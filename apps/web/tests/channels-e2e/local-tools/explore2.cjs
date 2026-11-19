const pw = require('/home/teo/.herdr/worktrees/macro/synoet-channels-e2e-base/node_modules/playwright');
const B = process.argv[2];
(async () => {
  const email = 'probe-a@channels-e2e.test';
  const api = await pw.request.newContext({ baseURL: B, ignoreHTTPSErrors: true });
  const { code } = await (await api.post('/auth/login/passwordless', { data: { email, redirect_uri: B + '/app' } })).json();
  await api.get(`/auth/oauth/passwordless/${code}?email=${encodeURIComponent(email)}`, { maxRedirects: 0 });
  const state = await api.storageState();
  console.log(state.cookies.map((c) => ({ ...c, value: c.value.slice(0, 8) })));
  const browser = await pw.chromium.launch({ headless: true });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, storageState: state });
  const page = await ctx.newPage();
  page.on('response', (r) => { if (r.status() >= 400 || /auth/.test(r.url())) console.log(r.status(), r.request().method(), r.url().slice(0, 110)); });
  await page.goto(`${B}/app/channels`);
  await page.waitForTimeout(12000);
  console.log('url', page.url());
  console.log((await ctx.cookies()).map((c) => c.name));
  await browser.close();
})();
