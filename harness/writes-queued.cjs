#!/usr/bin/env node
// PR 5 proof: own writes through the device queue. Output: results/writes-queued.json
const fs = require('node:fs'); const path = require('node:path');
const L = require(__dirname + '/lib.cjs');
const ch = L.ENV.channels.freshness; const out = { base: L.BASE, channel: ch, generatedAt: new Date().toISOString(), steps: {} };
const only = process.argv[2];
(async () => {
  const browser = await L.launch();
  const state = await L.authState(browser, 'alice@seed.macro.local');
  const ctx = await L.newContext(browser, { storageState: state });
  const page = await ctx.newPage(); let rec = await L.recorder(page);
  const url = `${L.BASE}/app/channels/${ch}`;
  const open = async (p) => { await p.goto(url); await p.waitForSelector('[data-channel-scroll] [data-message-id]', { timeout: 90_000 }); };
  await open(page); await L.sleep(6000);
  const rowsIn = (p, text) => p.evaluate((t) => [...document.querySelectorAll('[data-channel-scroll] [data-message-id]')].filter((n) => (n.textContent || '').includes(t)).length, text);
  const rows = (t) => rowsIn(page, t);
  const editor = () => page.locator('[data-markdown-editable]').last();
  const send = async (text) => { await editor().click(); await page.keyboard.type(text); const t0 = Date.now(); await page.keyboard.press('Enter'); return t0; };
  const opOf = (postData) => { try { return JSON.parse(postData || '{}').operationName; } catch (e) { return undefined; } };
  const reqs = (from, r = rec) => r.requests().filter((q) => q.start >= from && !L.isStatic(q.url)).map((q) => { const u = new URL(q.url); return `${q.method} ${opOf(q.postData) || u.pathname.replace(/[0-9a-f-]{36}/g, ':id')} ${q.status ?? 'failed'}`; }).filter((s) => /ChannelMessage|\/dss\/messages\/channel\/:id( |\/:id )/.test(s));
  const toast = (re) => page.evaluate((s) => new RegExp(s).test(document.body.textContent || ''), re);
  const toastText = () => page.evaluate(() => { const t = document.body.textContent || ''; const out = []; const re = /Failed to/g; let m; while ((m = re.exec(t))) out.push(t.slice(m.index, m.index + 70)); return out; });
  const rowText = (t) => page.evaluate((x) => [...document.querySelectorAll('[data-channel-scroll] [data-message-id]')].filter((n) => (n.textContent || '').includes(x)).map((n) => (n.textContent || '').slice(0, 200)), t);
  const clearDraft = async () => { await editor().click(); await page.keyboard.press('Control+A'); await page.keyboard.press('Delete'); };
  // Intercept one GraphQL operation; handler(route, n) with n = attempt number from 1.
  const intercept = async (opName, handler) => {
    let n = 0;
    const fn = (route) => { const rq = route.request(); if (rq.method() === 'POST' && opOf(rq.postData()) === opName) { n += 1; return handler(route, n); } return route.continue(); };
    await ctx.route('**/*', fn);
    return { attempts: () => n, stop: () => ctx.unroute('**/*', fn) };
  };
  const refuse = (code) => (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: null, errors: [{ message: 'refused', path: ['sendChannelMessage'], extensions: { code } }] }) });
  // A fresh profile reads the server, not this device.
  const serverCount = async (texts) => { const c2 = await L.newContext(browser, { storageState: state }); const p2 = await c2.newPage(); await open(p2); await L.sleep(4000); const r = {}; for (const t of texts) r[t] = await rowsIn(p2, t); await c2.close(); return r; };
  const step = async (name, fn) => { if (only && only !== name) return; try { out.steps[name] = await fn(); } catch (e) { out.steps[name] = { error: String(e && e.stack || e) }; } L.log(name, JSON.stringify(out.steps[name])); fs.writeFileSync(path.join(L.OUT, 'writes-queued.json'), JSON.stringify(out, null, 1)); };

  await step('send', async () => {
    const m = `q-send-${Date.now()}`; const t0 = await send(m);
    const at = await L.waitFor(async () => ((await rows(m)) > 0 ? Date.now() : null), { timeout: 10_000, interval: 5 });
    const counts = []; for (let k = 0; k < 8; k++) { await L.sleep(400); counts.push(await rows(m)); }
    return { appearedMs: at ? at - t0 : null, rowCountsOver3s: counts, requests: reqs(t0), server: await serverCount([m]) };
  });

  await step('send_offline_then_online', async () => {
    const m = `q-offline-${Date.now()}`;
    await rec.offline(true); const t0 = await send(m);
    const at = await L.waitFor(async () => ((await rows(m)) > 0 ? Date.now() : null), { timeout: 5000, interval: 5 });
    await L.sleep(8000);
    const whileOffline = { rows: await rows(m), toast: await toast('Failed to send message'), server: await serverCount([m]) };
    await rec.offline(false); const tOn = Date.now();
    const delivered = await L.waitFor(async () => (reqs(tOn).some((s) => /SendChannelMessage 200/.test(s)) ? Date.now() : null), { timeout: 120_000, interval: 100 });
    await L.sleep(3000);
    return { optimisticAppearedMs: at ? at - t0 : null, whileOffline, deliveredAfterReconnectMs: delivered ? delivered - tOn : null, rowsAfter: await rows(m), toast: await toast('Failed to send message'), requests: reqs(t0), server: await serverCount([m]) };
  });

  await step('send_blocked_reload_replay', async () => {
    const m = `q-reload-${Date.now()}`;
    const block = await intercept('SendChannelMessage', (route) => route.abort('internetdisconnected'));
    const t0 = await send(m);
    await L.waitFor(async () => ((await rows(m)) > 0 ? true : null), { timeout: 5000, interval: 5 });
    await L.sleep(4000);
    const before = { rows: await rows(m), attempts: block.attempts() };
    await page.reload(); rec = await L.recorder(page);
    await page.waitForSelector('[data-channel-scroll] [data-message-id]', { timeout: 90_000 }); await L.sleep(6000);
    const afterReload = { rows: await rows(m), attempts: block.attempts(), server: await serverCount([m]) };
    await block.stop(); const tOn = Date.now();
    const delivered = await L.waitFor(async () => (reqs(tOn).some((s) => /SendChannelMessage 200/.test(s)) ? Date.now() : null), { timeout: 180_000, interval: 200 });
    await L.sleep(3000);
    return { before, afterReload, deliveredAfterUnblockMs: delivered ? delivered - tOn : null, rowsAfter: await rows(m), server: await serverCount([m]) };
  });

  // The write guard's busy answer: retried with backoff (1, 2, 4, 8, 16 s), never dropped, never a toast.
  await step('send_busy_five_then_ok', async () => {
    const m = `q-busy5-${Date.now()}`;
    const busy = await intercept('SendChannelMessage', (route, n) => (n <= 5 ? refuse('SERVICE_UNAVAILABLE')(route) : route.continue()));
    const t0 = await send(m);
    const delivered = await L.waitFor(async () => (busy.attempts() >= 6 ? Date.now() : null), { timeout: 180_000, interval: 100 });
    const rowsWhileBusy = await rows(m);
    await L.sleep(4000); await busy.stop();
    return { attempts: busy.attempts(), deliveredMs: delivered ? delivered - t0 : null, rowsWhileBusy, rows: await rows(m), toast: await toast('Failed to send message'), server: await serverCount([m]) };
  });

  await step('send_forbidden', async () => {
    const m = `q-forbidden-${Date.now()}`;
    const block = await intercept('SendChannelMessage', refuse('FORBIDDEN'));
    const t0 = await send(m);
    const at = await L.waitFor(async () => ((await rows(m)) > 0 ? Date.now() : null), { timeout: 3000, interval: 5 });
    const goneAt = await L.waitFor(async () => ((await rows(m)) === 0 ? Date.now() : null), { timeout: 120_000, interval: 20 });
    const sawToast = await L.waitFor(async () => ((await toast('Failed to send message')) ? true : null), { timeout: 5000, interval: 50 });
    await L.sleep(1500);
    const draft = await editor().evaluate((n) => n.textContent || '');
    const r = { optimisticAppearedMs: at ? at - t0 : null, rolledBackAfterMs: goneAt ? goneAt - t0 : null, attempts: block.attempts(), rowsAfter: await rows(m), failureToast: !!sawToast, draftRestored: draft.includes(m), server: await serverCount([m]) };
    await block.stop(); await clearDraft(); await L.sleep(8000);
    return r;
  });

  // Three messages typed while nothing gets out, a reload, then the connection returns.
  await step('three_queued_reload_in_order', async () => {
    const tag = `q-order-${Date.now()}`; const texts = [1, 2, 3].map((k) => `${tag}-${k}`);
    const sentBodies = [];
    const block = await intercept('SendChannelMessage', (route) => route.abort('internetdisconnected'));
    for (const t of texts) { await send(t); await L.waitFor(async () => ((await rows(t)) > 0 ? true : null), { timeout: 5000, interval: 5 }); await L.sleep(300); }
    await L.sleep(3000);
    const before = { rows: await Promise.all(texts.map(rows)), attempts: block.attempts() };
    await page.reload(); rec = await L.recorder(page);
    await page.waitForSelector('[data-channel-scroll] [data-message-id]', { timeout: 90_000 }); await L.sleep(6000);
    const afterReload = { rows: await Promise.all(texts.map(rows)), server: await serverCount(texts) };
    await block.stop();
    const watch = await intercept('SendChannelMessage', (route) => { sentBodies.push(route.request().postData() || ''); return route.continue(); });
    await L.waitFor(async () => (sentBodies.length >= 3 ? true : null), { timeout: 240_000, interval: 200 });
    await L.sleep(5000); await watch.stop();
    const sentOrder = sentBodies.map((b) => (texts.find((t) => b.includes(t)) || '?').slice(tag.length + 1));
    const orderIn = (p) => p.evaluate((tg) => [...document.querySelectorAll('[data-channel-scroll] [data-message-id]')].map((n) => (n.textContent || '').match(new RegExp(tg + '-(\\d)'))).filter(Boolean).map((x) => x[1]), tag);
    const c2 = await L.newContext(browser, { storageState: state }); const p2 = await c2.newPage(); await open(p2); await L.sleep(4000);
    const serverOrder = await orderIn(p2); await c2.close();
    return { before, afterReload, requestsSentInOrder: sentOrder, deviceOrder: await orderIn(page), serverOrder };
  });

  // Edit, react and delete on messages whose send is still queued.
  const rowOf = (t) => page.locator('[data-channel-scroll] [data-message-id]', { hasText: t }).last();
  const act = async (t, label) => { await rowOf(t).hover(); await L.sleep(300); await page.locator('[data-message-hover-actions]:visible').last().locator(`button[aria-label="${label}"]`).click(); await L.sleep(400); };
  const confirmDelete = async () => { const b = page.locator('[role=dialog] button, [role=alertdialog] button', { hasText: /^Delete/ }).last(); if (await b.count()) { await b.click(); await L.sleep(300); return true; } return false; };
  const editTo = async (t, next) => { await act(t, 'Edit'); await page.keyboard.press('Control+A'); await page.keyboard.type(next); await page.keyboard.press('Enter'); await L.sleep(500); };
  const gqlLog = async () => { const seen = []; const fn = (route) => { const rq = route.request(); const op = rq.method() === 'POST' ? opOf(rq.postData()) : undefined; if (op && /ChannelMessage$/.test(op)) seen.push(op); return route.fallback(); }; await ctx.route('**/*', fn); return { seen, stop: () => ctx.unroute('**/*', fn) }; };
  const inspect = (p, texts) => p.evaluate((ts) => Object.fromEntries(ts.map((t) => { const n = [...document.querySelectorAll('[data-channel-scroll] [data-message-id]')].filter((x) => (x.textContent || '').includes(t)); return [t, { rows: n.length, thumbs: n.some((x) => (x.textContent || '').includes('👍')), edited: n.some((x) => /edited/i.test(x.textContent || '')) }]; })), texts);

  await step('edit_react_delete_while_send_queued', async () => {
    const tag = `q-act-${Date.now()}`; const a = `${tag}-keep`; const a2 = `${tag}-changed`; const b = `${tag}-drop`;
    const block = await intercept('SendChannelMessage', (route) => route.abort('internetdisconnected'));
    for (const t of [a, b]) { await send(t); await L.waitFor(async () => ((await rows(t)) > 0 ? true : null), { timeout: 5000, interval: 5 }); await L.sleep(300); }
    await act(a, 'React 👍'); await editTo(a, a2); await act(b, 'Delete'); const confirmed = await confirmDelete();
    await L.sleep(3000);
    const whileQueued = { device: await inspect(page, [a2, b, tag]), deleteConfirmDialog: confirmed, toastFailed: await toastText(), rowText: await rowText(tag), server: await serverCount([tag]) };
    await block.stop(); const log = await gqlLog();
    await L.waitFor(async () => (log.seen.length >= 5 ? true : null), { timeout: 240_000, interval: 200 });
    await L.sleep(5000); await log.stop();
    const c2 = await L.newContext(browser, { storageState: state }); const p2 = await c2.newPage(); await open(p2); await L.sleep(4000);
    const server = await inspect(p2, [a2, b, tag]); await c2.close();
    return { whileQueued, deliveredInOrder: log.seen, deviceAfter: await inspect(page, [a2, b, tag]), rowTextAfter: await rowText(tag), toastFailed: await toastText(), server };
  });

  // The send is refused for good while an edit of it waits behind it.
  await step('edit_behind_refused_send', async () => {
    const tag = `q-ref-${Date.now()}`; let refuseNow = false;
    const block = await intercept('SendChannelMessage', (route) => (refuseNow ? refuse('FORBIDDEN')(route) : route.abort('internetdisconnected')));
    await send(tag); await L.waitFor(async () => ((await rows(tag)) > 0 ? true : null), { timeout: 5000, interval: 5 });
    await editTo(tag, `${tag}-changed`); await L.sleep(1500);
    const log = await gqlLog(); refuseNow = true;
    const goneAt = await L.waitFor(async () => ((await rows(tag)) === 0 ? Date.now() : null), { timeout: 180_000, interval: 100 });
    await L.sleep(400); const toastsAtRollback = await page.evaluate(() => [...document.querySelectorAll('[data-sonner-toast], [role=status], [role=alert], [data-toast]')].map((n) => (n.textContent || '').slice(0, 80)));
    await L.sleep(6000); await log.stop(); await block.stop();
    const r = { toastsAtRollback, rowRemoved: !!goneAt, rowsAfter: await rows(tag), requestsAfterRefusal: log.seen, sendToast: await toast('Failed to send message'), anyFailureToast: await toastText(), draft: await page.evaluate(() => [...document.querySelectorAll('[data-markdown-editable]')].pop()?.textContent || '') };
    L.log('partial', JSON.stringify(r)); await page.screenshot({ path: path.join(L.OUT, 'refused-send.png') });
    r.server = await serverCount([tag]).catch((e) => ({ error: String(e).slice(0, 200) }));
    await clearDraft(); await L.sleep(3000);
    return r;
  });

  await step('unsent_indicator', async () => {
    const tag = `q-unsent-${Date.now()}`;
    const block = await intercept('SendChannelMessage', (route) => route.abort('internetdisconnected'));
    await send(tag); await L.waitFor(async () => ((await rows(tag)) > 0 ? true : null), { timeout: 5000, interval: 5 });
    const look = () => page.evaluate((t) => { const n = [...document.querySelectorAll('[data-channel-scroll] [data-message-id]')].filter((x) => (x.textContent || '').includes(t)).pop(); return n ? { label: !!n.querySelector('[data-message-unsent]'), opacity: getComputedStyle(n).opacity } : null; }, tag);
    await L.sleep(2000); const at2s = await look();
    await L.sleep(4500); const at6s = await look(); await page.screenshot({ path: path.join(L.OUT, 'unsent-indicator.png') });
    await block.stop();
    await L.waitFor(async () => { const v = await look(); return v && !v.label ? true : null; }, { timeout: 120_000, interval: 200 });
    await L.sleep(500);
    return { at2s, at6s, afterDelivery: await look(), server: await serverCount([tag]) };
  });

  await step('send_after_failures', async () => {
    const m = `q-retry-${Date.now()}`; const t0 = await send(m); await L.sleep(3000);
    return { rows: await rows(m), requests: reqs(t0), server: await serverCount([m]) };
  });

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
