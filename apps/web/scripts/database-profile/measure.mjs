/** Read-only browser benchmark. Run with --help for arguments. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    state: { type: 'string' },
    table: { type: 'string' },
    rows: { type: 'string' },
    entries: { type: 'string' },
    repeats: { type: 'string', default: '3' },
    output: { type: 'string' },
    chrome: { type: 'string' },
    profile: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});
if (values.help) {
  console.log(
    'bun scripts/database-profile/measure.mjs --url <database URL> --state <Playwright auth JSON> --rows <expected loaded rows> --entries <stored rows> --output <new directory> [--table <name>] [--repeats 3] [--chrome <executable>] [--profile]'
  );
  process.exit(0);
}
if (
  !values.url ||
  !values.state ||
  !values.output ||
  !values.rows ||
  !values.entries
)
  throw new Error('Required: --url, --state, --rows, --entries, --output');
const url = new URL(values.url);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  throw new Error('Use an isolated local stack on localhost.');
const expectedRows = Number(values.rows);
const entries = Number(values.entries);
const repeats = Number(values.repeats);
if (
  ![expectedRows, entries, repeats].every(
    (n) => Number.isSafeInteger(n) && n > 0
  ) ||
  entries < expectedRows
)
  throw new Error(
    'Row counts and repeats must be positive integers; entries must cover loaded rows.'
  );
const output = resolve(values.output);
await mkdir(output); // Refuse to overwrite a previous run.
const browser = await chromium.launch({
  executablePath: values.chrome,
  headless: true,
});
await writeFile(
  `${output}/environment.json`,
  JSON.stringify(
    {
      browser: browser.version(),
      startedAt: new Date().toISOString(),
      databasePath: url.pathname,
      entries,
      expectedRows,
      profile: values.profile,
    },
    null,
    2
  )
);
const results = [];
try {
  for (let repeat = 1; repeat <= repeats; repeat++) {
    const context = await browser.newContext({
      storageState: values.state,
      ignoreHTTPSErrors: true,
      viewport: { width: 1600, height: 1000 },
    });
    await context.addInitScript(() => {
      window.__databaseProfile = { longTasks: [] };
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          window.__databaseProfile.longTasks.push({
            start: entry.startTime,
            duration: entry.duration,
          });
      }).observe({ type: 'longtask', buffered: true });
    });
    const page = await context.newPage();
    const session = await context.newCDPSession(page);
    await session.send('Performance.enable');
    for (const temperature of ['cold', 'warm']) {
      const requests = [];
      const pending = [];
      const finished = (request) => {
        const path = new URL(request.url()).pathname;
        if (
          path !== '/dss/items/soup/graphql' &&
          path !== '/dss/databases' &&
          !path.startsWith('/dss/databases/')
        )
          return;
        pending.push(
          (async () => {
            const response = await request.response();
            requests.push({
              path,
              status: response?.status(),
              traceparent: request.headers().traceparent,
              timing: request.timing(),
              sizes: await request.sizes().catch(() => undefined),
            });
          })()
        );
      };
      page.on('requestfinished', finished);
      if (values.profile) {
        await session.send('Profiler.enable');
        await session.send('Profiler.start');
      }
      const started = performance.now();
      await page.goto(values.url, {
        waitUntil: 'domcontentloaded',
        timeout: 180_000,
      });
      if (values.table)
        await page
          .locator('[aria-label="Database tables"]')
          .getByText(values.table, { exact: true })
          .click();
      await page.waitForFunction(
        (count) => {
          const grid = document.querySelector('[role="grid"]');
          return (
            grid &&
            grid.querySelectorAll(
              '[data-grid-row-id]:not([data-grid-row-id^="draft:"])'
            ).length >= count
          );
        },
        expectedRows,
        { timeout: 180_000, polling: 100 }
      );
      const dataReadyMs = performance.now() - started;
      const snapshot = await page.evaluate(async () => {
        if (document.hidden)
          throw new Error('The benchmark tab must be visible.');
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        );
        const grid = document.querySelector('[role="grid"]');
        return {
          rows: grid.querySelectorAll(
            '[data-grid-row-id]:not([data-grid-row-id^="draft:"])'
          ).length,
          cells: grid.querySelectorAll('[role="gridcell"]').length,
          visibility: document.visibilityState,
          longTasks: window.__databaseProfile.longTasks,
        };
      });
      const frameReadyMs = performance.now() - started;
      const after = await session.send('Performance.getMetrics');
      // CDP navigation counters reset on document navigation.
      const metrics = Object.fromEntries(
        after.metrics.map(({ name, value }) => [name, value])
      );
      if (values.profile) {
        const { profile } = await session.send('Profiler.stop');
        await writeFile(
          `${output}/${repeat}-${temperature}.cpuprofile`,
          JSON.stringify(profile)
        );
      }
      // Capture refresh requests too, separately from the first rendering opportunity.
      await page.waitForTimeout(1500);
      page.off('requestfinished', finished);
      await Promise.all(pending);
      const result = {
        repeat,
        temperature,
        entries,
        expectedRows,
        dataReadyMs,
        frameReadyMs,
        ...snapshot,
        metrics,
        requests,
      };
      results.push(result);
      await writeFile(
        `${output}/results.json`,
        JSON.stringify(results, null, 2)
      );
      console.log(
        JSON.stringify({
          repeat,
          temperature,
          entries,
          loaded: snapshot.rows,
          dataReadyMs,
          frameReadyMs,
        })
      );
    }
    await context.close();
  }
} catch (error) {
  await writeFile(
    `${output}/failure.json`,
    JSON.stringify({ error: String(error), completed: results.length }, null, 2)
  );
  throw error;
} finally {
  await browser.close();
}
