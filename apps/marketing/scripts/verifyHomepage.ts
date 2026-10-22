import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { verifyDemo } from './verifyDemo';
import { verifyProductPages } from './verifyProductPages';

/** Verify the prerendered homepage keeps its first paint while becoming interactive. */
export async function verifyHomepage(directory: string): Promise<void> {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      let filename = path.resolve(
        directory,
        `.${pathname === '/' ? '/index.html' : pathname}`
      );
      if (!filename.startsWith(`${directory}/`))
        return new Response(null, { status: 404 });
      if (!path.extname(filename)) filename = path.join(filename, 'index.html');
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
    await verifyDemo(browser, origin);
    // Verify both neutral homepage palettes before and after hydration.
    for (const [viewport, colorScheme] of [
      [{ width: 1440, height: 1000 }, 'dark'],
      [{ width: 390, height: 844 }, 'light'],
    ] as const) {
      const label = `${viewport.width}×${viewport.height} ${colorScheme}`;
      const page = await browser.newPage({
        viewport,
        colorScheme,
        isMobile: viewport.width < 768,
        hasTouch: viewport.width < 768,
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

        await expect(page.locator('.macro-feature-tile')).toHaveCount(6);
        await expect(page.locator('.macro-homepage')).toHaveCSS(
          'background-color',
          colorScheme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)'
        );

        releaseScripts();
        await page.waitForLoadState('load');
        if (errors.length)
          throw new Error(
            `Homepage hydration failed (${label}): ${errors.join('; ')}`
          );
        await page.waitForSelector(
          '#root[data-public-ready="true"] .macro-feature-tile',
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

        if (viewport.width >= 768)
          await page
            .locator('.site-header')
            .getByRole('link', { name: 'Macro home', exact: true })
            .hover();
        else
          await page
            .getByRole('button', { name: 'Open navigation', exact: true })
            .tap();
        await page
          .getByRole('navigation', { name: 'Main navigation' })
          .waitFor({ state: 'visible' });
        if (viewport.width >= 768) await page.keyboard.press('Escape');
        else
          await page
            .getByRole('button', { name: 'Close navigation', exact: true })
            .tap();
        // Reduced motion is complete and static, with no meaningless pause control.
        await expect(
          page.getByRole('button', { name: 'Pause animation' })
        ).toBeHidden();
        await expect(
          page.locator('.macro-hero-after:visible .feature-flow-node').first()
        ).toHaveCSS('opacity', '1');
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        const pause = page.getByRole('button', { name: 'Pause animation' });
        await pause.click();
        await expect(
          page.getByRole('button', { name: 'Play animation' })
        ).toHaveAttribute('aria-pressed', 'true');
        await expect(
          page.locator('.macro-hero-before .ob-orbit-tile').first()
        ).toHaveCSS('animation-play-state', 'paused');
        await page.getByRole('button', { name: 'Play animation' }).click();
        await expect(
          page.locator('.macro-hero-before .ob-orbit-tile').first()
        ).toHaveCSS('animation-play-state', 'running');
        await page.locator('#email').scrollIntoViewIfNeeded();
        await expect(
          page.locator('.macro-hero-before .ob-orbit-tile').first()
        ).toHaveCSS('animation-play-state', 'paused');
        // Native previews follow live system theme changes without remounting.
        const previewBody = page.locator('#email .mail-thread-body').first();
        await expect(previewBody).toHaveText(/\S+/);
        await expect(previewBody).toHaveCSS(
          'color',
          colorScheme === 'light' ? 'rgb(36, 36, 40)' : 'rgb(255, 255, 255)'
        );
        await page.emulateMedia({
          colorScheme: colorScheme === 'light' ? 'dark' : 'light',
        });
        await expect(previewBody).toHaveCSS(
          'color',
          colorScheme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(36, 36, 40)'
        );
        await page.emulateMedia({ colorScheme });
        const dimensions = await page
          .locator('.macro-feature-grid')
          .evaluate((grid) => ({
            columns:
              getComputedStyle(grid).gridTemplateColumns.split(' ').length,
            overflow:
              (document.querySelector('.macro-home-scroll')?.scrollWidth ?? 0) >
              window.innerWidth,
          }));
        expect(dimensions.columns).toBe(1);
        expect(dimensions.overflow).toBe(false);
        await page
          .locator('#email')
          .getByRole('link', { name: 'Email', exact: true })
          .click();
        await expect(page).toHaveURL(`${origin}/email`);
        await page.goBack();
        await page.locator('.macro-home-hero .macro-home-button').click();
        await expect(page).toHaveURL(
          `${origin}${viewport.width < 640 ? '/mobile-signup' : '/app/signup'}`
        );
        if (errors.length)
          throw new Error(
            `Homepage demo failed (${label}): ${errors.join('; ')}`
          );
        console.log(
          `[prerender] Homepage ${label}: SSR heading identity and layout, hydration, navigation, feature links, animation, and signup routing verified`
        );
      } finally {
        releaseScripts();
        await page.close();
      }
    }
    await verifyProductPages(browser, origin);
  } finally {
    await browser?.close();
    server.stop(true);
  }
}
