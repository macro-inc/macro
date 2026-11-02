// Generate fixtures with the adapter's mail_window_benchmark example, then
// serve graphql/browser-test/vite.config.ts before running this script.
import { chromium } from '@playwright/test';
import type { MailProfileApi } from '../src/lib/queries/soup/graphql/browser-test/mail-profile';

const fixturePath = Bun.argv[2];
if (!fixturePath) throw new Error('Provide the native benchmark fixture JSON path');
const fixture: Parameters<MailProfileApi['seed']>[0] = await Bun.file(fixturePath).json();
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
try {
  const page = await browser.newPage();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto('http://127.0.0.1:4196/mail-profile.html');
  await page.waitForFunction(() => Boolean(window.mailProfile));
  await page.evaluate((input) => window.mailProfile.seed(input), fixture);
  const runs = [];
  for (const size of [20, 100, 499]) {
    const result = await page.evaluate(
      ({ filters, size }) => window.mailProfile.measure(filters, size),
      { filters: fixture.filters, size }
    );
    runs.push({
      ...result,
      // Drop the cold first-page read and the first through-read warmup.
      worker: result.worker.filter((sample) => sample.kind === 'entity-filter' && sample.through && sample.limit === size).slice(1),
    });
  }
  const report = JSON.stringify({
    browser: browser.version(),
    rendererCpuThrottlingRate: 4,
    scope: 'Real worker/WASM/OPFS filtering and row projection; excludes network and DOM.',
    runs,
  }, null, 2);
  if (Bun.argv[3]) await Bun.write(Bun.argv[3], `${report}\n`);
  console.log(report);
} finally {
  await browser.close();
}
