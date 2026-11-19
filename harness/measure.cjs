// Channel open-path measurements. Usage (repo root, inside nix develop):
//   node ~/.cache/channels-perf/measure.cjs <scenario> [--n 10] [--sizes small,medium,large] [--throttle] [--tag x]
// scenarios: cold_fresh | cold_login | session (warm switch + revisit + reload) | jump_old | jump_reply
// Writes results/<scenario>[-throttled].json incrementally (one record per sample).
const fs = require('node:fs'); const path = require('node:path');
const L = require('./lib.cjs');
const FX = JSON.parse(fs.readFileSync(path.join(L.HERE, 'fixture.json'), 'utf8'));
const args = process.argv.slice(2); const scenario = args[0];
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const N = Number(opt('n', 10)); const sizes = opt('sizes', 'small,medium,large').split(','); const throttled = args.includes('--throttle');
const tag = opt('tag', ''); const EMAIL = 'alice@seed.macro.local';
const outFile = path.join(L.OUT, `${scenario}${throttled ? '-throttled' : ''}${tag ? '-' + tag : ''}.json`);
const records = [];
const save = () => fs.writeFileSync(outFile, JSON.stringify({ scenario, throttled, throttle: throttled ? L.THROTTLE : null, n: N, sizes, base: L.BASE, generatedAt: new Date().toISOString(), records }, null, 1));

const snap = (page) => page.evaluate(() => window.__probe.snapshot()).catch(() => null);
async function waitSnap(page, pred, timeout = 90_000) {
  let last = null;
  const ok = await L.waitFor(async () => { last = await snap(page); return last && pred(last) ? last : null; }, { timeout, interval: 40 });
  return ok || { ...(last || {}), timedOut: true };
}
function ltSummary(longTasks, fromMs, toMs) {
  const xs = (longTasks || []).filter((t) => t.start >= fromMs && (toMs == null || t.start <= toMs));
  return { count: xs.length, totalMs: Math.round(xs.reduce((a, t) => a + t.duration, 0)), maxMs: Math.round(Math.max(0, ...xs.map((t) => t.duration))) };
}
// Collect one phase: t0Wall = wall-clock ms of the phase start; t0Perf = same instant on the page clock.
async function finish(page, rec, { t0Wall, t0Perf, m0, s, extra, keepPost }) {
  const processBaseline = m0;
  const mSettle = await rec.metrics();
  await L.sleep(2000);
  const mTail = await rec.metrics();
  // A cross-process navigation restarts the renderer's counters: fall back to a zero baseline.
  if (mSettle.TaskDuration < m0.TaskDuration) m0 = zeroM; const s2 = (await snap(page)) || s;
  const rel = (v) => (v == null ? null : Math.round((v - t0Perf) * 10) / 10);
  const fpWall = s.targetHighlighted != null ? s.timeOrigin + s.targetHighlighted : s.firstPaint != null ? s.timeOrigin + s.firstPaint : null;
  const settleWall = s.settled != null ? s.timeOrigin + s.settled : fpWall;
  const reqs = rec.requests();
  const wf = L.waterfall(reqs, t0Wall, fpWall).filter((w) => w.startMs <= (settleWall ? settleWall - t0Wall + 2500 : 1e9));
  if (!keepPost) for (const w of wf) delete w.postData;
  const before = wf.filter((w) => w.startedBeforeFirstPaint);
  const frames = rec.frames().filter((f) => f.at >= t0Wall && f.preview !== 'ping' && f.preview !== 'pong')
    .map((f) => ({ ws: new URL(f.ws).pathname, dir: f.dir, atMs: Math.round(f.at - t0Wall), bytes: f.bytes, preview: f.preview.slice(0, 220) }));
  const sc = await page.evaluate(() => { const e = document.querySelector('[data-channel-scroll]'); return e ? { top: Math.round(e.scrollTop), h: e.clientHeight, sh: e.scrollHeight, atBottom: e.scrollHeight - e.scrollTop - e.clientHeight <= 2 } : null; }).catch(() => null);
  return {
    firstDomMs: rel(s.firstDom), firstPaintMs: rel(s.firstPaint), lastSeenMs: rel(s.lastSeen), settledMs: rel(s.settled),
    targetVisibleMs: rel(s.target), targetHighlightedMs: rel(s.targetHighlighted), timedOut: !!s.timedOut,
    domMessages: s2.domMessages, visibleMessages: s2.visibleMessages, domNodes: s2.domNodes, scroll: sc,
    cpuToSettle: L.metricDelta(m0, mSettle), cpuToSettlePlus2s: L.metricDelta(m0, mTail),
    longTasks: ltSummary(s2.longTasks, t0Perf, s.settled != null ? s.settled + 500 : null),
    requests: { total: wf.length, startedBeforeFirstPaint: before.length, finishedBeforeFirstPaint: wf.filter((w) => w.finishedBeforeFirstPaint).length,
      bytesBeforeFirstPaint: before.reduce((a, w) => a + (w.bytes || 0), 0),
      channelScoped: wf.filter((w) => w.path.includes(extra.channelId) || /Channel/.test(w.op || '')).length },
    static: L.staticSummary(reqs.filter((r) => r.start <= (settleWall || Infinity)), t0Wall),
    waterfall: wf, wsFrames: frames.slice(0, 80), ...extra,
  };
}
const zeroM = { Timestamp: 0, TaskDuration: 0, ScriptDuration: 0, LayoutDuration: 0, RecalcStyleDuration: 0, LayoutCount: 0, RecalcStyleCount: 0, JSHeapUsedSize: 0, Nodes: 0 };

async function coldNav(page, rec, c, url, armOpts, pred, keepPost) {
  await page.addInitScript((o) => { try { window.__probe.arm(o); } catch (e) {} }, armOpts);
  const m0 = zeroM;
  const mark = Date.now();
  await page.goto(url, { waitUntil: 'commit' });
  const s = await waitSnap(page, pred);
  const nav = rec.requests().filter((r) => r.type === 'Document' && r.start >= mark - 5).sort((a, b) => a.start - b.start)[0];
  // Navigation start on the page clock is 0 (performance.timeOrigin); the wall start is the document request.
  return finish(page, rec, { t0Wall: nav ? nav.start : s.timeOrigin, t0Perf: 0, m0, s, keepPost, extra: { channelId: c.id, navToTimeOriginMs: nav ? Math.round(s.timeOrigin - nav.start) : null } });
}

async function run() {
  const browser = await L.launch();
  const state = await L.authState(browser, EMAIL);
  for (let i = 0; i < N; i++) {
    for (const size of sizes) {
      const c = FX.channels[size]; const t = Date.now(); let recs = [];
      try {
        if (scenario === 'cold_fresh' || scenario === 'jump_old' || scenario === 'jump_reply') {
          const ctx = await L.newContext(browser, { storageState: state }); await ctx.addInitScript(L.PROBE);
          const page = await ctx.newPage(); const rec = await L.recorder(page); if (throttled) await rec.throttle(true);
          let url = `${L.BASE}/app/channels/${c.id}`; let arm = { ids: [], lastId: c.lastRootId }; let pred = (s) => s.settled != null; let target = null;
          if (scenario === 'jump_old') { target = c.oldRoot.id; url += `?s0.channels.messageId=${target}`; }
          if (scenario === 'jump_reply') { target = c.threadReply.replyId; url += `?s0.channels.messageId=${target}&s0.channels.threadId=${c.threadReply.rootId}`; }
          if (target) { arm = { ids: [], targetId: target }; pred = (s) => s.targetHighlighted != null && s.target != null && s.firstPaint != null; }
          const r = await coldNav(page, rec, c, url, arm, pred, i === 0);
          recs.push({ phase: scenario, ...r, target }); await ctx.close();
        } else if (scenario === 'cold_login') {
          const ctx = await L.newContext(browser); await ctx.addInitScript(L.PROBE);
          const page = await ctx.newPage(); const rec = await L.recorder(page);
          await L.login(page, EMAIL); await L.sleep(Number(process.env.SESSION_SETTLE_MS || 6000));
          // Open the channel in a new tab of the same context (old tab closed first): persisted client caches and
          // the HTTP cache are warm, the renderer is new, so CPU counters start at zero.
          await page.close(); const page2 = await ctx.newPage(); const rec2 = await L.recorder(page2);
          if (throttled) await rec2.throttle(true);
          const r = await coldNav(page2, rec2, c, `${L.BASE}/app/channels/${c.id}`, { ids: [], lastId: c.lastRootId }, (s) => s.settled != null && /channels\//.test(s.url), i === 0);
          recs.push({ phase: scenario, ...r }); await ctx.close();
        } else if (scenario === 'session') {
          const lobby = L.ENV.channels.lobby;
          const ctx = await L.newContext(browser, { storageState: state }); await ctx.addInitScript(L.PROBE);
          const page = await ctx.newPage(); const rec = await L.recorder(page);
          await page.goto(`${L.BASE}/app/channels/${lobby}`);
          await page.waitForSelector('[data-channel-scroll] [data-message-id]', { timeout: 90_000 });
          await L.sleep(Number(process.env.SESSION_SETTLE_MS || 6000));
          if (throttled) await rec.throttle(true);
          const clickTo = async (channelId, armOpts, phase) => {
            const row = page.locator(`[role="treeitem"][id$="-channel:${channelId}"]`).first();
            await row.scrollIntoViewIfNeeded({ timeout: 15_000 });
            await page.evaluate((o) => { window.__probe.arm(o); window.__probe.armClick(); }, armOpts);
            const m0 = await rec.metrics();
            await row.click();
            const s = await waitSnap(page, (x) => x.settled != null && x.clickAt != null);
            const t0Perf = s.clickAt ?? s.armedAt;
            const r = await finish(page, rec, { t0Wall: s.timeOrigin + t0Perf, t0Perf, m0, s, keepPost: i === 0, extra: { channelId } });
            await page.evaluate(() => { if (window.__probe.watch) window.__probe.watch.stop = true; });
            return { phase, ...r };
          };
          const targetArm = { ids: c.latestRootIds, lastId: c.lastRootId };
          recs.push(await clickTo(c.id, targetArm, 'warm_switch'));
          await clickTo(lobby, { ids: [L.ENV.lobbyLastId], lastId: L.ENV.lobbyLastId, settleMs: 300 }, 'back_to_lobby').catch(() => {});
          await page.waitForSelector(`[role="treeitem"][id$="-channel:${lobby}"][aria-current="page"]`, { timeout: 15_000 }).catch(() => {});
          await L.sleep(1500);
          recs.push(await clickTo(c.id, targetArm, 'revisit'));
          await L.sleep(1000);
          // Reload in place: same context, so persisted client caches and the HTTP cache are present.
          await page.evaluate(() => { if (window.__probe.watch) window.__probe.watch.stop = true; });
          await page.addInitScript((o) => { try { window.__probe.arm(o); } catch (e) {} }, { ids: [], lastId: c.lastRootId });
          const m0 = await rec.metrics(); const mark = Date.now();
          await page.reload({ waitUntil: 'commit' });
          const s = await waitSnap(page, (x) => x.settled != null && x.timeOrigin > mark - 50);
          const nav = rec.requests().filter((q) => q.type === 'Document' && q.start >= mark - 5).sort((a, b) => a.start - b.start)[0];
          const r = await finish(page, rec, { t0Wall: nav ? nav.start : s.timeOrigin, t0Perf: 0, m0, s, keepPost: i === 0, extra: { channelId: c.id } });
          recs.push({ phase: 'reload', ...r }); await ctx.close();
        } else throw new Error('unknown scenario ' + scenario);
      } catch (e) { recs.push({ phase: scenario, error: String(e && e.stack || e).slice(0, 600) }); }
      for (const r of recs) { records.push({ size, i, ...r }); L.log(scenario, throttled ? 'thr' : '', size, i, r.phase, r.error ? 'ERROR ' + r.error.slice(0, 200) : `first=${r.firstPaintMs} settled=${r.settledMs} target=${r.targetHighlightedMs} dom=${r.domMessages} reqBeforeFP=${r.requests.startedBeforeFirstPaint} task=${r.cpuToSettle.taskMs}${r.timedOut ? ' TIMEOUT' : ''}`); }
      save(); L.log('  sample took', Date.now() - t, 'ms');
    }
  }
  await browser.close();
}
run().catch((e) => { console.error(e); save(); process.exit(1); });
