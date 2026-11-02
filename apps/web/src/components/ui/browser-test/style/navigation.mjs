import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

function summarize(events) {
  const marks = events
    .filter((event) => event.name.startsWith('style-nav/'))
    .sort((a, b) => a.ts - b.ts);
  const selectors = new Map();
  const invalidations = new Map();
  for (const event of events) {
    for (const row of event.args?.selector_stats?.selector_timings ?? []) {
      const total = selectors.get(row.selector) ?? {
        selector: row.selector,
        elapsedUs: 0,
        attempts: 0,
        matches: 0,
        fastRejects: 0,
      };
      total.elapsedUs += row['elapsed (us)'];
      total.attempts += row.match_attempts;
      total.matches += row.match_count;
      total.fastRejects += row.fast_reject_count;
      selectors.set(row.selector, total);
    }
    if (event.name === 'StyleRecalcInvalidationTracking') {
      const reason = event.args?.data?.reason ?? 'unknown';
      invalidations.set(reason, (invalidations.get(reason) ?? 0) + 1);
    }
  }
  const navigation = marks.map((mark, index) => {
    const end = marks[index + 1]?.ts ?? Infinity;
    const recalc = events.filter(
      (event) =>
        event.pid === mark.pid &&
        event.tid === mark.tid &&
        event.name === 'UpdateLayoutTree' &&
        event.ts >= mark.ts &&
        event.ts < end
    );
    return {
      route: mark.name.slice('style-nav'.length),
      recalcMs: recalc.reduce((sum, event) => sum + (event.dur ?? 0), 0) / 1000,
      elements: recalc.reduce(
        (sum, event) => sum + (event.args?.elementCount ?? 0),
        0
      ),
      recalcs: recalc.length,
    };
  });
  return {
    navigation,
    selectorsByTime: [...selectors.values()]
      .sort((a, b) => b.elapsedUs - a.elapsedUs)
      .slice(0, 20),
    selectorsByAttempts: [...selectors.values()]
      .sort((a, b) => b.attempts - a.attempts)
      .slice(0, 20),
    invalidations: Object.fromEntries(
      [...invalidations].sort((a, b) => b[1] - a[1])
    ),
  };
}

if (process.argv[2]) {
  const trace = JSON.parse(await readFile(process.argv[2], 'utf8'));
  console.log(JSON.stringify(summarize(trace.traceEvents), null, 2));
} else {
  const state = process.env.STYLE_STATE;
  if (!state)
    throw new Error(
      'STYLE_STATE must point to an authorized test session outside the repository'
    );
  const output = process.env.STYLE_OUTPUT ?? '/tmp/navigation-style';
  const base = process.env.STYLE_BASE ?? 'https://localhost:3008';
  const selectors = process.env.STYLE_SELECTORS === '1';
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  });
  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1440, height: 900 },
      storageState: state,
    });
    const page = await context.newPage();
    let loads = 0;
    const errors = [];
    page.on('load', () => loads++);
    page.on('pageerror', (error) => errors.push(error.message));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto(`${base}/app/home`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForSelector(
      process.env.STYLE_READY_SELECTOR ?? '[data-split-id]',
      { timeout: 90000 }
    );
    await page.waitForTimeout(15000);
    await page.evaluate(() => {
      window.styleMutations = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          const element = record.target;
          let depth = 0;
          for (
            let parent = element;
            parent && parent !== document.documentElement;
            parent = parent.parentElement
          )
            depth++;
          if (depth <= 3)
            window.styleMutations.push({
              tag: element.tagName,
              depth,
              attribute: record.attributeName,
            });
        }
      });
      observer.observe(document.documentElement, {
        subtree: true,
        attributes: true,
      });
    });
    if (selectors) {
      await cdp.send('DOM.enable');
      await cdp.send('CSS.enable');
    }
    const done = new Promise((resolve) =>
      cdp.once('Tracing.tracingComplete', resolve)
    );
    await cdp.send('Tracing.start', {
      categories: selectors
        ? 'devtools.timeline,disabled-by-default-devtools.timeline,blink.debug,disabled-by-default-blink.debug,disabled-by-default-devtools.timeline.invalidationTracking,blink.user_timing'
        : 'devtools.timeline,blink.user_timing',
      transferMode: 'ReturnAsStream',
    });
    const metrics = async () =>
      Object.fromEntries(
        (await cdp.send('Performance.getMetrics')).metrics.map(
          ({ name, value }) => [name, value]
        )
      );
    const initialLoads = loads;
    const rows = [];
    for (const route of ['/drive', '/tasks', '/home', '/mail']) {
      const before = await metrics();
      await page.evaluate((route) => {
        window.styleMutations = [];
        performance.mark(`style-nav${route}`);
        history.pushState({}, '', `/app${route}`);
        dispatchEvent(new PopStateEvent('popstate'));
      }, route);
      await page.waitForTimeout(2500);
      const after = await metrics();
      rows.push({
        route,
        recalcMs:
          1000 * (after.RecalcStyleDuration - before.RecalcStyleDuration),
        recalcCount: after.RecalcStyleCount - before.RecalcStyleCount,
        taskMs: 1000 * (after.TaskDuration - before.TaskDuration),
        mutations: await page.evaluate(() => window.styleMutations),
      });
    }
    await cdp.send('Tracing.end');
    const { stream } = await done;
    let trace = '';
    while (true) {
      const part = await cdp.send('IO.read', { handle: stream });
      trace += part.data;
      if (part.eof) break;
    }
    await cdp.send('IO.close', { handle: stream });
    await writeFile(`${output}/trace.json`, trace);
    const summary = {
      selectorStatsEnabled: selectors,
      rows,
      errors,
      reloads: loads - initialLoads,
      ...summarize(JSON.parse(trace).traceEvents),
    };
    await writeFile(`${output}/summary.json`, JSON.stringify(summary, null, 2));
    if (errors.length || loads !== initialLoads)
      throw new Error(
        'Capture invalidated by a page error or reload; see summary.json'
      );
    console.log(
      JSON.stringify({
        output,
        navigation: summary.navigation,
        metrics: rows.map(({ mutations, ...row }) => row),
      })
    );
  } finally {
    await browser.close();
  }
}
