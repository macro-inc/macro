import { chromium, type FullConfig } from '@playwright/test';

/**
 * Loads the fixture once before the tests, so the dev server builds its
 * modules (thousands, on a cold start) before any test's clock runs.
 */
export default async function warmUp(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) return;
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  });
  const page = await browser.newPage();
  await page.route(
    (url) => url.hostname !== '127.0.0.1',
    (route) => route.abort()
  );
  await page.goto(baseURL, { timeout: 600_000 });
  await page
    .getByRole('heading', { name: 'Document' })
    .waitFor({ timeout: 600_000 });
  await browser.close();
}
