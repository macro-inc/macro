import { chromium } from 'playwright';
import fs from 'node:fs';

const out = process.env.OUT;
if (!out)
  throw new Error('Set OUT to an evidence directory outside the checkout');
const url = new URL(
  '/src/features/command/browser-test/scale.html',
  process.env.URL ?? 'https://localhost:3009'
);
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    args: ['--ignore-certificate-errors', '--enable-precise-memory-info'],
  });
  try {
    for (const size of [1000, 5000, 20000]) {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await ctx.newPage(),
        errors = [];
      await ctx.addInitScript(() => {
        window.__messages = {};
        for (const [label, proto] of [
          ['port', MessagePort.prototype],
          ['worker', Worker.prototype],
        ]) {
          const orig = proto.postMessage;
          proto.postMessage = function (m, ...args) {
            const payload = Array.isArray(m) ? m[1] : m;
            const kind = payload?.request?.kind ?? payload?.kind;
            if (kind) {
              const key = label + ':' + kind;
              window.__messages[key] = (window.__messages[key] ?? 0) + 1;
            }
            return orig.call(this, m, ...args);
          };
        }
      });
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(url.href, {
        waitUntil: 'domcontentloaded',
        timeout: 90000,
      });
      await page.waitForFunction(
        () => window.commandScale,
        {},
        { timeout: 90000 }
      );
      await page.waitForTimeout(3000);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        () => window.commandScale,
        {},
        { timeout: 90000 }
      );
      await page.waitForTimeout(1000);
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await cdp.send('HeapProfiler.collectGarbage');
      const before = await cdp.send('Runtime.getHeapUsage');
      const seed = await page.evaluate(
        (n) => window.commandScale.seed(n),
        size
      );
      await cdp.send('HeapProfiler.collectGarbage');
      const after = await cdp.send('Runtime.getHeapUsage');
      const cold = await page.evaluate(() =>
        window.commandScale.engine('project')
      );
      const data = await page.evaluate(async () => {
        const a = window.commandScale,
          rows = [];
        for (let r = 0; r < 7; r++)
          for (const q of a.samples) {
            rows.push({
              q,
              js: a.rank(q),
              ...(r < 3 ? { engine: await a.engine(q) } : {}),
            });
          }
        return rows;
      });
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
      await cdp.send('Profiler.start');
      await page.evaluate(() => {
        for (const q of window.commandScale.samples)
          window.commandScale.rank(q);
      });
      const { profile } = await cdp.send('Profiler.stop');
      fs.writeFileSync(
        out + '/' + size + '.cpuprofile',
        JSON.stringify(profile)
      );
      if (errors.length) throw Error(errors.join('\n'));
      if (
        (await page.evaluate(() => window.commandScale.instance)) !==
        seed.instance
      )
        throw Error('Fixture reloaded during measurement');
      const messages = await page.evaluate(() => window.__messages);
      const result = {
        size,
        seed,
        cold,
        heapBefore: before,
        heapAfter: after,
        messages,
        data,
      };
      fs.writeFileSync(out + '/' + size + '.json', JSON.stringify(result));
      const q = (a, p) => a.sort((x, y) => x - y)[Math.ceil(a.length * p) - 1];
      console.log(
        JSON.stringify({
          size,
          seed,
          cold,
          jsP50: q(
            data.map((x) => x.js.totalMs),
            0.5
          ),
          jsP95: q(
            data.map((x) => x.js.totalMs),
            0.95
          ),
          engineP50: q(
            data.filter((x) => x.engine).map((x) => x.engine.searchMs),
            0.5
          ),
          engineP95: q(
            data.filter((x) => x.engine).map((x) => x.engine.searchMs),
            0.95
          ),
          heapDelta: after.usedSize - before.usedSize,
          messages,
        })
      );
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
