#!/usr/bin/env node
// Load at start for a person with several hundred unread channels. `seed N` creates N channels (bob + alice) with one
// message from bob each. `measure` opens the app as alice, touches nothing for WATCH_MS and records every request.
const fs = require('node:fs'); const L = require((process.env.HARNESS_DIR || __dirname) + '/lib.cjs');
const WATCH = Number(process.env.WATCH_MS || 150000);
(async () => {
  const browser = await L.launch(); const mode = process.argv[2];
  if (mode === 'seed') {
    const n = Number(process.argv[3] || 300);
    const bc = await L.newContext(browser, { storageState: await L.authState(browser, 'bob@seed.macro.local'), insecure: true });
    let ok = 0;
    for (let i = 0; i < n; i++) {
      const r = await bc.request.post(`${L.BASE}/dss/channels`, { data: { channel_type: 'private', name: `unread-load-${String(i).padStart(3, '0')}`, participants: ['macro|alice@seed.macro.local'] } });
      if (!r.ok()) { console.log('create failed', r.status(), (await r.text()).slice(0, 200)); break; }
      const body = await r.json(); const id = body.id || body.channel_id || (body.channel && body.channel.id);
      const m = await bc.request.post(`${L.BASE}/dss/messages/channel/${id}`, { data: { content: `unread load message ${i}`, nonce: `ul${i}${Date.now()}` } });
      if (m.ok()) ok++; else { console.log('post failed', m.status(), (await m.text()).slice(0, 200)); break; }
    }
    console.log('seeded', ok);
  } else {
    const ctx = await L.newContext(browser, { storageState: await L.authState(browser, 'alice@seed.macro.local') });
    const page = await ctx.newPage(); const rec = await L.recorder(page); const t0 = Date.now();
    await page.goto(`${L.BASE}/app/`); await L.sleep(WATCH);
    const reqs = rec.requests().filter((r) => !L.isStatic(r.url)).map((r) => { let op; try { op = JSON.parse(r.postData || '{}').operationName; } catch (e) {} return { at: Math.round(r.start - t0), op: op || new URL(r.url).pathname.replace(/[0-9a-f-]{36}/g, ':id'), ms: Math.round(r.end ? r.end - r.start : 0), bytes: r.bytes || 0, status: r.status }; });
    const by = {}; for (const r of reqs) { const k = r.op; by[k] = by[k] || { n: 0, ms: 0, bytes: 0 }; by[k].n++; by[k].ms += r.ms; by[k].bytes += r.bytes; }
    const PRE = new Set(['ChannelTimeline', 'ChannelChanges']);
    const pre = reqs.filter((r) => PRE.has(r.op)); const rest = reqs.filter((r) => !PRE.has(r.op));
    const sum = (a, k) => a.reduce((s, r) => s + r[k], 0);
    const buckets = {}; for (const r of pre) { const b = Math.floor(r.at / 10000) * 10; buckets[b] = (buckets[b] || 0) + 1; }
    let maxConcurrent = 0; for (const r of pre) { const c = pre.filter((o) => o.at <= r.at && o.at + o.ms > r.at).length; maxConcurrent = Math.max(maxConcurrent, c); }
    const out = { base: L.BASE, watchMs: WATCH, total: { n: reqs.length, ms: sum(reqs, 'ms'), bytes: sum(reqs, 'bytes') }, withoutPrewarm: { n: rest.length, ms: sum(rest, 'ms'), bytes: sum(rest, 'bytes') }, prewarm: { n: pre.length, ms: sum(pre, 'ms'), bytes: sum(pre, 'bytes'), firstAtMs: pre[0] && pre[0].at, lastAtMs: pre.length && pre[pre.length - 1].at, maxConcurrent, per10s: buckets }, channelLists: by.ChannelListSoup || null, byOp: by };
    fs.writeFileSync((process.env.HARNESS_DIR || __dirname) + `/results/prewarm-load${process.env.TAG ? '-' + process.env.TAG : ''}.json`, JSON.stringify(out, null, 1));
    console.log(JSON.stringify({ ...out, byOp: undefined }));
  }
  await browser.close();
})().catch((e) => { console.error(String(e).slice(0, 400)); process.exit(1); });
