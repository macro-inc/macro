import path from 'node:path';
import { chromium } from '@playwright/test';

/** Verify the prerendered homepage keeps its first paint while becoming interactive. */
export async function verifyHomepage(directory: string): Promise<void> {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      const filename = path.resolve(
        directory,
        `.${pathname === '/' ? '/index.html' : pathname}`
      );
      if (!filename.startsWith(`${directory}/`))
        return new Response(null, { status: 404 });
      const file = Bun.file(filename);
      return (await file.exists())
        ? new Response(file)
        : new Response(null, { status: 404 });
    },
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch();
    const origin = `http://127.0.0.1:${server.port}`;
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 390, height: 844 },
    ]) {
      const label = `${viewport.width}×${viewport.height}`;
      const page = await browser.newPage({
        viewport,
        isMobile: viewport.width < 768,
        reducedMotion: 'reduce',
      });
      let releaseScripts!: () => void;
      const scriptsReady = new Promise<void>((resolve) => {
        releaseScripts = resolve;
      });
      // Hold JS until the server-rendered page has painted. This makes identity
      // and layout comparisons deterministic even on a fast build machine.
      await page.route('**/*', async (route) => {
        if (new URL(route.request().url()).origin !== origin) {
          await route.abort();
          return;
        }
        if (route.request().resourceType() === 'script') await scriptsReady;
        await route.continue();
      });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (/hydration mismatch/i.test(message.text()))
          errors.push(message.text());
      });
      try {
        await page.goto(origin, { waitUntil: 'commit' });
        const headingLocator = page.locator('[data-welcome-heading]');
        await headingLocator.waitFor({ state: 'visible' });
        await page.evaluate(() => document.fonts.ready);
        const heading = await headingLocator.elementHandle();
        if (!heading) throw new Error(`Homepage has no SSR heading (${label})`);
        const before = await heading.boundingBox();
        const initialText = await heading.textContent();
        const rootHeight = await page
          .locator('#root')
          .evaluate((element) => element.getBoundingClientRect().height);
        if (Math.abs(rootHeight - viewport.height) > 1)
          throw new Error(
            `Homepage SSR root height is ${rootHeight}, expected viewport height ${viewport.height} (${label})`
          );

        releaseScripts();
        await page.waitForLoadState('load');
        if (errors.length)
          throw new Error(
            `Homepage hydration failed (${label}): ${errors.join('; ')}`
          );
        await page.waitForSelector(
          '#root[data-public-ready="true"] .homepage-feature',
          {
            state: 'attached',
            timeout: 10000,
          }
        );
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          );
        });
        if (!(await heading.evaluate((element) => element.isConnected)))
          throw new Error(
            `Homepage replaced its first-painted heading during hydration (${label})`
          );
        if ((await heading.textContent()) !== initialText)
          throw new Error(
            `Homepage changed heading text during hydration (${label})`
          );
        const after = await heading.boundingBox();
        if (
          !before ||
          !after ||
          (['x', 'y', 'width', 'height'] as const).some(
            (key) => Math.abs(before[key] - after[key]) > 1
          )
        )
          throw new Error(
            `Homepage heading moved during hydration (${label}): ${JSON.stringify({ before, after })}`
          );
        await heading.dispose();

        await page
          .getByRole('button', { name: 'Open navigation', exact: true })
          .click();
        await page
          .getByRole('navigation', { name: 'Main navigation' })
          .waitFor({ state: 'visible' });
        await page
          .getByRole('button', { name: 'Close navigation', exact: true })
          .click();
        await page.locator('#email').scrollIntoViewIfNeeded();
        await page
          .locator('[data-email-demo-body]')
          .waitFor({ state: 'visible' });
        if (errors.length)
          throw new Error(
            `Homepage demo failed (${label}): ${errors.join('; ')}`
          );
        console.log(
          `[prerender] Homepage ${label}: SSR heading identity and layout, hydration, navigation, and email demo verified`
        );
      } finally {
        releaseScripts();
        await page.close();
      }
    }
  } finally {
    await browser?.close();
    server.stop(true);
  }
}
