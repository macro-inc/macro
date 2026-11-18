import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = process.env.ROW_OUTPUT ?? '/tmp/entity-row-cost';
const url =
  process.env.ROW_URL ??
  'https://localhost:3008/src/features/entity/browser-test/long-list.html?benchmark&count=200';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'],
});
try {
  const page = await browser.newPage({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
  });
  const errors = [];
  const rejected = [];
  let capturing = false;
  page.on('load', () => {
    if (capturing) errors.push('Unexpected reload during capture');
  });
  const origin = new URL(url).origin;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const request = route.request();
    const resource = new URL(request.url());
    const asset = [
      '/src/',
      '/node_modules/',
      '/@fs/',
      '/@vite/',
      '/@id/',
      '/assets/',
    ].some((prefix) => resource.pathname.startsWith(prefix));
    if (
      resource.origin !== origin ||
      (['fetch', 'xhr'].includes(request.resourceType()) && !asset)
    ) {
      rejected.push(resource.origin + resource.pathname);
      await route.abort();
    } else await route.continue();
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(
    () => window.entityRowBenchmark !== undefined,
    undefined,
    { timeout: 90000 }
  );
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('load');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const metrics = async () =>
    Object.fromEntries(
      (await cdp.send('Performance.getMetrics')).metrics.map(
        ({ name, value }) => [name, value]
      )
    );
  const frame = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    );
  const invoke = (action) =>
    page.evaluate((action) => {
      const api = window.entityRowBenchmark;
      const before = api.stats();
      const elements = [
        ...document.querySelectorAll(
          '[data-entity], [data-button], [role=checkbox]'
        ),
      ];
      const start = performance.now();
      api[action]();
      const durationMs = performance.now() - start;
      if (['select', 'rename', 'replace'].includes(action)) {
        const current = [
          ...document.querySelectorAll(
            '[data-entity], [data-button], [role=checkbox]'
          ),
        ];
        if (
          elements.length !== current.length ||
          elements.some((element, index) => current[index] !== element)
        )
          throw new Error(`${action} replaced row or action DOM`);
      }
      const after = api.stats();
      if (action === 'select' && after.checked !== (after.selected ? 200 : 0))
        throw new Error('Selection did not reach every checkbox');
      if (
        ['rename', 'replace'].includes(action) &&
        !document
          .querySelector('[data-entity]')
          .textContent.includes(after.firstName)
      )
        throw new Error('Updated model did not reach row content');
      return { durationMs, before, after };
    }, action);
  // Warm module caches, variant strings and model proxies outside captures.
  await invoke('mount');
  await frame();
  await invoke('clear');
  await frame();
  capturing = true;
  const captures = [];
  for (let round = 0; round < 5; round++) {
    for (const phase of ['mount', 'select', 'rename', 'replace', 'clear']) {
      const before = await metrics();
      const result = await invoke(phase);
      await frame();
      const after = await metrics();
      if (phase !== 'clear' && result.after.rows !== 200)
        throw new Error(`Expected 200 rows in ${phase}`);
      if (
        ['select', 'rename', 'replace'].includes(phase) &&
        result.after.mounts !== result.before.mounts
      )
        throw new Error(`${phase} remounted rows`);
      captures.push({
        round,
        phase,
        ...result,
        scriptMs: 1000 * (after.ScriptDuration - before.ScriptDuration),
        taskMs: 1000 * (after.TaskDuration - before.TaskDuration),
      });
    }
  }
  const allocations = [];
  for (const phase of ['mount', 'select', 'rename', 'replace', 'clear']) {
    await cdp.send('HeapProfiler.collectGarbage');
    const before = await metrics();
    await cdp.send('HeapProfiler.startSampling', {
      samplingInterval: 16384,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true,
    });
    const result = await invoke(phase);
    await frame();
    const { profile } = await cdp.send('HeapProfiler.stopSampling');
    const after = await metrics();
    const bytes = (node) =>
      node.selfSize +
      node.children.reduce((sum, child) => sum + bytes(child), 0);
    allocations.push({
      phase,
      sampledAllocatedBytes: bytes(profile.head),
      heapGrowthBytes: after.JSHeapUsedSize - before.JSHeapUsedSize,
      ...result,
    });
  }
  // Separate diagnostic pass: profiler overhead is excluded from timing samples.
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  for (const phase of ['mount', 'select', 'rename', 'replace', 'clear']) {
    await cdp.send('Profiler.start');
    await invoke(phase);
    const { profile } = await cdp.send('Profiler.stop');
    await writeFile(`${output}/${phase}.cpuprofile`, JSON.stringify(profile));
    await frame();
  }
  await invoke('mount');
  await frame();
  await page.screenshot({ path: `${output}/rows.png` });
  const classes = await page.locator('[data-entity]').evaluateAll((rows) =>
    rows.map((row) =>
      [...row.querySelectorAll('*'), row].map((element) => ({
        tag: element.tagName,
        class: element.getAttribute('class'),
        slot: element.getAttribute('data-slot'),
      }))
    )
  );
  if (errors.length || rejected.length)
    throw new Error(JSON.stringify({ errors, rejected }));
  const report = {
    captures,
    allocations,
    stats: await page.evaluate(() => window.entityRowBenchmark.stats()),
    classes,
  };
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
  const median = (values) =>
    values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  console.log(
    JSON.stringify({
      phases: Object.fromEntries(
        ['mount', 'select', 'rename', 'replace', 'clear'].map((phase) => [
          phase,
          {
            medianMs: median(
              captures
                .filter((row) => row.phase === phase)
                .map((row) => row.durationMs)
            ),
            sampledAllocatedBytes: allocations.find(
              (row) => row.phase === phase
            ).sampledAllocatedBytes,
          },
        ])
      ),
      stats: report.stats,
    })
  );
} finally {
  await browser.close();
}
