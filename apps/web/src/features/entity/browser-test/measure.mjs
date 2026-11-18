import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = process.env.LIST_OUTPUT ?? '/tmp/runtime-long-list';
const url = process.env.LIST_URL ?? 'https://localhost:3009/src/features/entity/browser-test/long-list.html';
await mkdir(output, { recursive: true });
const results = [];
for (const mode of ['default', 'software']) {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    args: ['--disable-http2', ...(mode === 'software' ? ['--disable-gpu'] : [])],
  });
  try {
    const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
    const errors = [];
    const requests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', async (route) => {
      const request = route.request();
      const resource = new URL(request.url());
      const staticFetch = ['/src/', '/node_modules/', '/@fs/', '/@vite/', '/@id/', '/assets/'].some((prefix) => resource.pathname.startsWith(prefix));
      const apiFetch = ['fetch', 'xhr'].includes(request.resourceType()) && !staticFetch;
      if (resource.origin !== new URL(url).origin || apiFetch) {
        requests.push(resource.origin + resource.pathname);
        await route.abort();
        return;
      }
      await route.continue();
    });
    await page.addInitScript(() => {
      const capture = { nonce: crypto.randomUUID(), start: 0, active: false, raf: 0, timers: {}, longEntries: [] };
      window.__runtimeCapture = capture;
      for (const kind of ['setTimeout', 'setInterval']) {
        const original = window[kind].bind(window);
        window[kind] = (callback, delay, ...args) => {
          if (typeof callback !== 'function') return original(callback, delay, ...args);
          const key = `${kind}:${delay ?? 0}`;
          return original((...values) => {
            if (capture.active && (key in capture.timers || Object.keys(capture.timers).length < 64)) {
              capture.timers[key] = (capture.timers[key] ?? 0) + 1;
            }
            callback.apply(window, values);
          }, delay, ...args);
        };
      }
      const originalFrame = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) => originalFrame((time) => {
        if (capture.active) capture.raf++;
        callback(time);
      });
      for (const type of ['longtask', 'long-animation-frame']) {
        if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
        new PerformanceObserver((list) => {
          if (!capture.active) return;
          for (const entry of list.getEntries()) {
            if (entry.startTime >= capture.start && capture.longEntries.length < 200) capture.longEntries.push({ type, startTime: entry.startTime, duration: entry.duration, blockingDuration: entry.blockingDuration });
          }
        }).observe({ type });
      }
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.locator('[data-entity]').first().waitFor({ timeout: 90000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(2000);
    if (errors.length || requests.length) throw new Error(JSON.stringify({ errors, requests }));
    const nonce = await page.evaluate(() => window.__runtimeCapture.nonce);
    const count = await page.locator('[data-entity]').count();
    if (count !== 1000) throw new Error(`Expected 1000 mounted rows, got ${count}`);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]));
    for (const phase of ['idle', 'scroll', 'hover']) {
      const traceFinished = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
      await cdp.send('Tracing.start', { categories: 'devtools.timeline,blink.user_timing,cc,gpu', transferMode: 'ReturnAsStream' });
      await page.evaluate(() => {
        Object.assign(window.__runtimeCapture, { start: performance.now(), active: true, raf: 0, timers: {}, longEntries: [] });
      });
      const before = await metrics();
      if (phase === 'idle') await page.waitForTimeout(10000);
      if (phase === 'scroll') {
        await page.mouse.move(500, 450);
        for (let index = 0; index < 40; index++) {
          await page.mouse.wheel(0, 500);
          await page.waitForTimeout(100);
        }
        await page.waitForTimeout(300);
      }
      if (phase === 'hover') {
        for (let index = 0; index < 80; index++) {
          await page.mouse.move(300, 30 + (index % 20) * 40);
          await page.waitForTimeout(40);
        }
        await page.mouse.move(2, 2);
        await page.waitForTimeout(300);
      }
      const after = await metrics();
      const capture = await page.evaluate(() => {
        window.__runtimeCapture.active = false;
        return { ...window.__runtimeCapture, rows: document.querySelectorAll('[data-entity]').length, scrollTop: document.querySelector('[data-list]').scrollTop };
      });
      if (capture.nonce !== nonce || capture.rows !== count || after.TaskDuration < before.TaskDuration) throw new Error('Page changed during capture');
      if (phase === 'scroll' && capture.scrollTop <= 0) throw new Error('Wheel input did not scroll the collection');
      await cdp.send('Tracing.end');
      const { stream } = await traceFinished;
      let trace = '';
      for (;;) {
        const chunk = await cdp.send('IO.read', { handle: stream });
        trace += chunk.data;
        if (chunk.eof) break;
      }
      await cdp.send('IO.close', { handle: stream });
      await writeFile(`${output}/${mode}-${phase}-trace.json`, trace);
      const events = JSON.parse(trace).traceEvents;
      const counts = {};
      for (const name of ['Paint', 'RasterTask', 'ProxyImpl::ScheduledActionDraw', 'CompositeLayers', 'GPUTask']) {
        const matches = events.filter((event) => event.name === name);
        counts[name] = { count: matches.length, durationMs: matches.reduce((sum, event) => sum + (event.dur ?? 0), 0) / 1000 };
      }
      const row = { mode, phase, delta: Object.fromEntries(['Timestamp', 'TaskDuration', 'ScriptDuration', 'RecalcStyleDuration', 'LayoutDuration', 'RecalcStyleCount', 'LayoutCount'].map((key) => [key, after[key] - before[key]])), capture, counts };
      results.push(row);
      await page.screenshot({ path: `${output}/${mode}-${phase}.png` });
      console.log(JSON.stringify(row));
      await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
    }
    if (errors.length || requests.length) throw new Error(JSON.stringify({ errors, requests }));
  } finally {
    await browser.close();
  }
}
