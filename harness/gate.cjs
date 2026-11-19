// Causality check for "does request X gate the first message paint?": hold one request class
// for +1000 ms with page.route and see whether first paint moves by ~1000 ms.
// Cold (fresh context, direct URL) and warm (click from #lobby), medium channel, 3 samples each.
// Usage: node ~/.cache/channels-perf/gate.cjs [--size medium] [--n 3]
const fs = require('node:fs'); const path = require('node:path');
const L = require('./lib.cjs');
const FX = JSON.parse(fs.readFileSync(path.join(L.HERE, 'fixture.json'), 'utf8'));
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const size = arg('size', 'medium'); const N = Number(arg('n', 3)); const DELAY = 1000;
const c = FX.channels[size];
const op = (name) => (req) => { if (!/graphql$/.test(new URL(req.url()).pathname)) return false; try { return JSON.parse(req.postData() || '{}').operationName === name; } catch (e) { return false; } };
const p = (re) => (req) => re.test(new URL(req.url()).pathname);
const CLASSES = {
  baseline: null,
  timeline: p(/\/messages\/channel\/[^/]+\/timeline$/),
  ChannelDetailSoup: op('ChannelDetailSoup'),
  ChannelListSoup: op('ChannelListSoup'),
  ChannelUnreadPresence: op('ChannelUnreadPresence'),
  Soup: op('Soup'),
  participants: p(/\/channels\/[^/]+\/participants$/),
  channel_bots: p(/\/channels\/[^/]+\/bots$/),
  call_active: p(/\/call\/[^/]+\/active$/),
  comms_channels_list: p(/\/dss\/comms\/channels$/),
  channels_activity: p(/\/dss\/channels\/activity$/),
  get_names_with_email: p(/\/auth\/user\/get_names_with_email$/),
  legacy_user_permissions: p(/\/auth\/user\/legacy_user_permissions$/),
  jwt_refresh: p(/\/auth\/jwt\/refresh$/),
  auth_team: p(/\/auth\/team$/),
  agents: p(/\/dss\/agents$/),
  properties_definitions: p(/\/dss\/properties\/definitions$/),
};
const out = { size, delayMs: DELAY, cold: {}, warm: {}, revisit: {} };
const snap = (page) => page.evaluate(() => window.__probe.snapshot()).catch(() => null);
async function route(ctx, match, counter) {
  await ctx.route('**/*', async (r) => {
    const req = r.request();
    if (match && (req.resourceType() === 'fetch' || req.resourceType() === 'xhr') && match(req)) { counter.n++; await L.sleep(DELAY); }
    await r.continue().catch(() => {});
  });
}
(async () => {
  const browser = await L.launch(); const state = await L.authState(browser, 'alice@seed.macro.local');
  for (const [name, match] of Object.entries(CLASSES)) {
    const cold = []; const warm = []; const revisit = []; const held = { n: 0 };
    for (let i = 0; i < N; i++) {
      // cold
      { const ctx = await L.newContext(browser, { storageState: state }); await ctx.addInitScript(L.PROBE); await route(ctx, match, held);
        const page = await ctx.newPage(); await page.addInitScript((o) => window.__probe.arm(o), { ids: [], lastId: c.lastRootId });
        await page.goto(`${L.BASE}/app/channels/${c.id}`, { waitUntil: 'commit' });
        const s = await L.waitFor(async () => { const x = await snap(page); return x && x.firstPaint != null ? x : null; }, { timeout: 60_000, interval: 30 });
        cold.push(s ? Math.round(s.firstPaint) : null); await ctx.close(); }
      // warm
      { const ctx = await L.newContext(browser, { storageState: state }); await ctx.addInitScript(L.PROBE);
        const page = await ctx.newPage(); await page.goto(`${L.BASE}/app/channels/${L.ENV.channels.lobby}`);
        await page.waitForSelector('[data-channel-scroll] [data-message-id]', { timeout: 90_000 }); await L.sleep(5000);
        const before = held.n; await route(ctx, match, held);
        const row = page.locator(`[role="treeitem"][id$="-channel:${c.id}"]`).first(); await row.scrollIntoViewIfNeeded();
        await page.evaluate((o) => { window.__probe.arm(o); window.__probe.armClick(); }, { ids: c.latestRootIds, lastId: c.lastRootId });
        await row.click();
        const s = await L.waitFor(async () => { const x = await snap(page); return x && x.firstPaint != null && x.clickAt != null ? x : null; }, { timeout: 60_000, interval: 30 });
        warm.push(s ? Math.round(s.firstPaint - s.clickAt) : null); out.warm[name] = { heldRequests: held.n - before };
        // revisit: back to #lobby, then the target again (its pages are now in the in-memory query cache)
        await page.evaluate(() => { window.__probe.watch.stop = true; });
        await page.locator(`[role="treeitem"][id$="-channel:${L.ENV.channels.lobby}"]`).first().click();
        await page.waitForSelector(`[data-message-id="${L.ENV.lobbyLastId}"]`, { timeout: 30_000 }).catch(() => {}); await L.sleep(2500);
        const before2 = held.n;
        await page.evaluate((o) => { window.__probe.arm(o); window.__probe.armClick(); }, { ids: c.latestRootIds, lastId: c.lastRootId });
        await row.click();
        const s2 = await L.waitFor(async () => { const x = await snap(page); return x && x.firstPaint != null && x.clickAt != null ? x : null; }, { timeout: 60_000, interval: 30 });
        revisit.push(s2 ? Math.round(s2.firstPaint - s2.clickAt) : null); out.revisit[name] = { heldRequests: held.n - before2 }; await ctx.close(); }
    }
    const med = (xs) => L.stats(xs).median;
    out.cold[name] = { firstPaintMs: cold, median: med(cold), heldRequestsTotal: held.n };
    out.warm[name] = { ...out.warm[name], firstPaintMs: warm, median: med(warm) };
    out.revisit[name] = { ...out.revisit[name], firstPaintMs: revisit, median: med(revisit) };
    L.log(name.padEnd(26), 'cold', JSON.stringify(cold), 'warm', JSON.stringify(warm), 'revisit', JSON.stringify(revisit), 'held', held.n);
    fs.writeFileSync(path.join(L.OUT, `gate-${size}.json`), JSON.stringify(out, null, 1));
  }
  const b = out.cold.baseline.median; const bw = out.warm.baseline.median;
  for (const k of Object.keys(CLASSES)) { out.cold[k].deltaVsBaseline = Math.round(out.cold[k].median - b); out.warm[k].deltaVsBaseline = Math.round(out.warm[k].median - bw); out.revisit[k].deltaVsBaseline = Math.round(out.revisit[k].median - out.revisit.baseline.median); }
  fs.writeFileSync(path.join(L.OUT, `gate-${size}.json`), JSON.stringify(out, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
