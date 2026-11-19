#!/usr/bin/env node
// Own writes through the UI against the open timeline: optimistic insert, no duplicate from the echo,
// rollback on a failed request and on the write guard's 503, a reaction toggle; then a reopen.
// HARNESS_DIR picks the instance (its lib.cjs / env.json). Output: results/writes.json in that dir.
const fs = require('node:fs'); const path = require('node:path');
const L = require((process.env.HARNESS_DIR || __dirname) + '/lib.cjs');
const ch = L.ENV.channels.freshness; const out = { base: L.BASE, channel: ch, generatedAt: new Date().toISOString(), steps: {} };
(async () => {
  const browser = await L.launch();
  const ctx = await L.newContext(browser, { storageState: await L.authState(browser, 'alice@seed.macro.local') });
  const page = await ctx.newPage(); const rec = await L.recorder(page);
  await page.goto(`${L.BASE}/app/channels/${ch}`);
  await page.waitForSelector('[data-channel-scroll] [data-message-id]', { timeout: 90_000 });
  await L.sleep(6000);
  const rows = (text) => page.evaluate((t) => [...document.querySelectorAll('[data-channel-scroll] [data-message-id]')].filter((n) => (n.textContent || '').includes(t)).length, text);
  const editor = page.locator('[data-markdown-editable]').last();
  const send = async (text) => { await editor.click(); await page.keyboard.type(text); const t0 = Date.now(); await page.keyboard.press('Enter'); return t0; };
  const reqs = (from) => rec.requests().filter((r) => r.start >= from && !L.isStatic(r.url)).map((r) => { const u = new URL(r.url); let op; try { op = JSON.parse(r.postData || '{}').operationName; } catch (e) {} return `${r.method} ${op || u.pathname.replace(/[0-9a-f-]{36}/g, ':id')} ${r.status ?? 'failed'}`; });
  const toast = () => page.evaluate(() => /Failed to send message/.test(document.body.textContent || ''));

  { // 1. a send that succeeds
    const m = `own-send-${Date.now()}`; const t0 = await send(m);
    const at = await L.waitFor(async () => ((await rows(m)) > 0 ? Date.now() : null), { timeout: 10_000, interval: 5 });
    const counts = []; for (let k = 0; k < 8; k++) { await L.sleep(400); counts.push(await rows(m)); }
    out.steps.send = { appearedMs: at ? at - t0 : null, rowCountsOver3s: counts, maxRows: Math.max(...counts), requests: reqs(t0) };
    L.log('send', JSON.stringify(out.steps.send));
  }
  for (const [name, handler] of [
    ['send_request_fails', (r) => r.abort()],
    ['send_503_busy', (r) => r.fulfill({ status: 503, headers: { 'retry-after': '1' }, contentType: 'application/json', body: JSON.stringify({ message: 'conversation is busy; retry the request' }) })],
  ]) {
    const pattern = `**/dss/messages/channel/${ch}`;
    await page.route(pattern, (r) => (r.request().method() === 'POST' ? handler(r) : r.continue()));
    const m = `${name}-${Date.now()}`; const t0 = await send(m);
    const at = await L.waitFor(async () => ((await rows(m)) > 0 ? Date.now() : null), { timeout: 3000, interval: 5 });
    const goneAt = await L.waitFor(async () => ((await rows(m)) === 0 ? Date.now() : null), { timeout: 10_000, interval: 10 });
    const sawToast = await L.waitFor(async () => ((await toast()) ? true : null), { timeout: 5000, interval: 50 });
    await L.sleep(1500);
    const draft = await editor.evaluate((n) => n.textContent || '');
    out.steps[name] = { optimisticAppearedMs: at ? at - t0 : null, rolledBackAfterMs: goneAt ? goneAt - t0 : null, rowsAfter: await rows(m), failureToast: !!sawToast, draftRestored: draft.includes(m), requests: reqs(t0) };
    L.log(name, JSON.stringify(out.steps[name]));
    await page.unroute(pattern);
    // Clear the restored draft so the next step starts empty.
    await editor.click(); await page.keyboard.press('Control+A'); await page.keyboard.press('Delete'); await L.sleep(8000);
  }
  { // 4. the retry of the same text after the failures goes through once
    const m = `own-retry-${Date.now()}`; const t0 = await send(m); await L.sleep(3000);
    out.steps.send_after_failures = { rows: await rows(m), requests: reqs(t0) }; L.log('retry', JSON.stringify(out.steps.send_after_failures));
    out.lastMarker = m;
  }
  { // 5. reopen in a new tab: every own write is there once, the failed ones are not
    const p2 = await ctx.newPage(); await p2.goto(`${L.BASE}/app/channels/${ch}`);
    await p2.waitForSelector('[data-channel-scroll] [data-message-id]', { timeout: 60_000 }); await L.sleep(3000);
    const count = (t) => p2.evaluate((t) => [...document.querySelectorAll('[data-channel-scroll] [data-message-id]')].filter((n) => (n.textContent || '').includes(t)).length, t);
    out.steps.reopen = { ownSend: await count('own-send-'), retry: await count('own-retry-'), failed: await count('send_request_fails-'), busy: await count('send_503_busy-') };
    L.log('reopen', JSON.stringify(out.steps.reopen)); await p2.close();
  }
  fs.writeFileSync(path.join(L.OUT, 'writes.json'), JSON.stringify(out, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(L.OUT, 'writes.partial.json'), JSON.stringify(out, null, 1)); process.exit(1); });
