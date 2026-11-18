import { chromium } from 'playwright';
import fs from 'node:fs';
const id = process.env.SESSION_ID;
const state = process.env.SESSION_STATE;
if (!id || !state) throw new Error('SESSION_ID and SESSION_STATE are required');
const base = process.env.SESSION_BASE ?? 'https://localhost:3008';
const output = process.env.SESSION_OUTPUT ?? '/tmp/agent-session-open';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  args: ['--enable-precise-memory-info'],
});
try {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
    storageState: state,
  });
  const page = await context.newPage();
  const errors = [];
  let loads = 0;
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.error('pageerror', e.message);
  });
  page.on('load', () => loads++);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto(`${base}/app/home`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForSelector(
    process.env.SESSION_READY_SELECTOR ?? '[data-split-id]',
    { timeout: 90000 }
  );
  await page.waitForTimeout(15000);
  const responses = [];
  page.on('response', async (response) => {
    const request = response.request();
    if (request.resourceType() !== 'fetch' && request.resourceType() !== 'xhr')
      return;
    const url = new URL(response.url());
    if (
      !url.pathname.includes('graphql') &&
      !url.pathname.includes('agent-sessions')
    )
      return;
    try {
      const data = await response.body();
      responses.push({
        path: url.pathname,
        operation: request.postDataJSON()?.operationName,
        bytes: data.length,
        timing: request.timing(),
        status: response.status(),
      });
    } catch {}
  });
  const samples = [];
  const initialLoads = loads;
  for (
    let sample = 0;
    sample < Number(process.env.SESSION_SAMPLES ?? 5);
    sample++
  ) {
    await page.evaluate(() => {
      performance.clearMeasures();
      performance.clearMarks();
      window.debugAgentSessionLoad = true;
    });
    responses.length = 0;
    await cdp.send('HeapProfiler.collectGarbage');
    const before = Object.fromEntries(
      (await cdp.send('Performance.getMetrics')).metrics.map((x) => [
        x.name,
        x.value,
      ])
    );
    if (sample === 0) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.start');
    }
    const started = Date.now();
    const navigationStarted = await page.evaluate((id) => {
      const start = performance.now();
      history.pushState({}, '', '/app/agents/' + id);
      dispatchEvent(new PopStateEvent('popstate'));
      return start;
    }, id);
    await page.waitForFunction(
      (id) =>
        performance
          .getEntriesByType('measure')
          .some(
            (x) =>
              x.detail?.sessionId === id &&
              (x.name === 'agent.session.load.painted' ||
                (x.name === 'agent.session.load' &&
                  x.detail.outcome === 'failed'))
          ),
      id,
      { timeout: 90000 }
    );
    const failed = await page.evaluate(
      (id) =>
        performance
          .getEntriesByName('agent.session.load')
          .some(
            (x) => x.detail?.sessionId === id && x.detail.outcome === 'failed'
          ),
      id
    );
    if (failed) throw new Error('Session load failed before painting');
    await page.waitForTimeout(500);
    const data = await page.evaluate(() => ({
      measures: performance
        .getEntriesByType('measure')
        .filter((x) => x.name.startsWith('agent.session'))
        .map((x) => ({
          name: x.name,
          start: x.startTime,
          ms: x.duration,
          detail: x.detail,
        })),
      rows: document.querySelectorAll('[data-index]').length,
      scroll: [...document.querySelectorAll('*')]
        .filter(
          (x) =>
            x.scrollHeight > x.clientHeight + 100 &&
            /^(auto|scroll)$/.test(getComputedStyle(x).overflowY)
        )
        .map((x) => ({
          top: x.scrollTop,
          height: x.scrollHeight,
          viewport: x.clientHeight,
        })),
      rowIndexes: [...document.querySelectorAll('[data-index]')].map((x) =>
        Number(x.getAttribute('data-index'))
      ),
    }));
    if (sample === 0) {
      const { profile } = await cdp.send('Profiler.stop');
      fs.writeFileSync(`${output}.cpuprofile`, JSON.stringify(profile));
    }
    await cdp.send('HeapProfiler.collectGarbage');
    const after = Object.fromEntries(
      (await cdp.send('Performance.getMetrics')).metrics.map((x) => [
        x.name,
        x.value,
      ])
    );
    const result = {
      sample,
      navigationStarted,
      wallMs: Date.now() - started,
      ...data,
      responses: [...responses],
      taskMs: 1000 * (after.TaskDuration - before.TaskDuration),
      scriptMs: 1000 * (after.ScriptDuration - before.ScriptDuration),
      styleMs: 1000 * (after.RecalcStyleDuration - before.RecalcStyleDuration),
      heapMB: after.JSHeapUsedSize / 1e6,
      nodes: after.Nodes,
    };
    samples.push(result);
    console.log(JSON.stringify(result));
    const expected = Number(process.env.SESSION_MESSAGES);
    if (expected > 0 && !result.rowIndexes.includes(expected - 1))
      throw new Error('The final transcript row is not mounted');
    if (
      expected > 30 &&
      !result.scroll.some((x) => Math.abs(x.height - x.viewport - x.top) < 2)
    )
      throw new Error('Transcript did not position at the end');
    await page.screenshot({ path: `${output}-${sample}.png` });
    if (errors.length || loads !== initialLoads)
      throw new Error(
        JSON.stringify({ errors, reloads: loads - initialLoads })
      );
    await page.evaluate(() => {
      history.pushState({}, '', '/app/home');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    await page.waitForSelector(
      process.env.SESSION_READY_SELECTOR ?? '[data-split-id]',
      { timeout: 90000 }
    );
    await page.waitForTimeout(1500);
  }
  fs.writeFileSync(
    `${output}.json`,
    JSON.stringify(
      { id, samples, errors, reloads: loads - initialLoads },
      null,
      2
    )
  );
} finally {
  await browser.close();
}
