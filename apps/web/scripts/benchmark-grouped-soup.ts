// bun scripts/benchmark-grouped-soup.ts /tmp/grouped-soup-benchmark.json
// Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH when using a system Chromium.
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import type { runGroupedSoupBenchmark } from '../src/lib/queries/soup/graphql/grouped-local-projection.benchmark';

console.error('Building the browser benchmark…');
const bundle = await Bun.build({
  entrypoints: [fileURLToPath(new URL('../src/lib/queries/soup/graphql/grouped-local-projection.benchmark.ts', import.meta.url))],
  target: 'browser',
  conditions: ['browser'],
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
});
if (!bundle.success) throw new AggregateError(bundle.logs, 'Benchmark build failed');
console.error('Launching Chromium…');
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
try {
  const page = await browser.newPage();
  page.on('console', (message) => console.error(message.text()));
  console.error('Loading the benchmark…');
  await page.addScriptTag({ content: await bundle.outputs[0].text(), type: 'module' });
  await page.waitForFunction(() => typeof window.runGroupedSoupBenchmark === 'function');
  const cdp = await page.context().newCDPSession(page);
  const runs: Array<{ cpuThrottlingRate: number; measurement: ReturnType<typeof runGroupedSoupBenchmark> }> = [];
  for (const cpuThrottlingRate of [1, 4]) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottlingRate });
    console.error(`Measuring at ${cpuThrottlingRate}x CPU throttle…`);
    const measurement = await page.evaluate(() => window.runGroupedSoupBenchmark());
    runs.push({ cpuThrottlingRate, measurement });
  }
  const report = {
    timestamp: new Date().toISOString(),
    browser: browser.version(),
    cpu: cpus()[0]?.model,
    scope: 'Tracked Solid-store projection and loaded-page merge; excludes worker, IPC, network and DOM.',
    runs,
  };
  const json = JSON.stringify(report, null, 2);
  if (Bun.argv[2]) await Bun.write(Bun.argv[2], `${json}\n`);
  console.log(json);
} finally {
  await browser.close();
}
