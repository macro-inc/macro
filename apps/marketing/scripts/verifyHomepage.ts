import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { verifyDemo } from './verifyDemo';
import { verifyProductPages } from './verifyProductPages';

/** Verify the prerendered homepage keeps its first paint while becoming interactive. */
export async function verifyHomepage(
  directory: string,
  browserType: typeof chromium = chromium
): Promise<void> {
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
    browser = await browserType.launch();
    const origin = `http://127.0.0.1:${server.port}`;
    if (browserType === chromium) await verifyDemo(browser, origin);
    // Verify both neutral homepage palettes before and after hydration.
    for (const [viewport, colorScheme] of [
      [{ width: 1440, height: 1000 }, 'dark'],
      [{ width: 390, height: 844 }, 'light'],
    ] as const) {
      const label = `${browserType.name()} ${viewport.width}×${viewport.height} ${colorScheme}`;
      const page = await browser.newPage({
        viewport,
        colorScheme,
        isMobile: viewport.width < 768,
        hasTouch: viewport.width < 768,
        reducedMotion: 'reduce',
      });
      page.setDefaultTimeout(15000);
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
        if (
          /hydration mismatch|Unable to initialize the public website/i.test(
            message.text()
          )
        )
          errors.push(message.text());
      });
      try {
        await page.goto(origin, { waitUntil: 'commit' });
        const headingLocator = page.locator('[data-welcome-heading]');
        await headingLocator.waitFor({ state: 'visible' });
        // WebKit's fonts.ready can wait for the load event, which our held
        // module scripts deliberately prevent. Load the first-paint fonts directly.
        await page.evaluate(() =>
          Promise.all([
            document.fonts.load('32px "Roboto Slab Variable"'),
            document.fonts.load('16px "Inter Variable"'),
          ])
        );
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

        await expect(page.locator('.homepage-feature')).toHaveCount(5);
        await expect(page.locator('#app-scroll-root')).toHaveCSS(
          'background-color',
          'rgb(0, 0, 0)'
        );

        // Lower sections are prerendered too: their lazy chunk's CSS must be
        // available before scripts run, or the GitHub SVG fills the page.
        const githubMark = page.locator('.homepage-github-mark');
        await expect(githubMark).toHaveCSS(
          'background-color',
          'rgb(30, 30, 30)'
        );
        const markBounds = await githubMark.boundingBox();
        const iconBounds = await githubMark.locator('svg').boundingBox();
        expect(markBounds?.width).toBeGreaterThan(100);
        expect(markBounds?.width).toBeLessThanOrEqual(152);
        expect(iconBounds?.width).toBeGreaterThan(50);
        expect(iconBounds?.width).toBeLessThanOrEqual(76);

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
        if (viewport.width >= 700) {
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
        } else {
          // Mobile replaces the desktop SSR fallback with its landing composition.
          await expect(page.locator('.ob-welcome')).toHaveCSS(
            'display',
            'flex'
          );
          await expect(page.locator('[data-onboarding-hero]')).toHaveCSS(
            'display',
            'flex'
          );
          await expect(page.locator('.ob-welcome-logo')).toHaveCSS(
            'width',
            '96px'
          );
          await expect(page.locator('.ob-welcome-logo svg')).toHaveCSS(
            'width',
            '48px'
          );
          await expect(page.locator('.ob-welcome h1')).toHaveCSS(
            'font-family',
            /Roboto Slab Variable/
          );
          await expect(
            page.locator('.ob-welcome [data-welcome-heading]')
          ).toBeVisible();
          await expect(
            page.locator('.ob-welcome [data-welcome-heading]')
          ).toHaveText(/The unified workspace\s*for your company\./);
          await expect(page.locator('.homepage-hero-cta')).toBeVisible();
        }
        await heading.dispose();

        if (viewport.width < 768)
          await page
            .getByRole('button', { name: 'Open navigation', exact: true })
            .click();
        await page
          .getByRole('navigation', { name: 'Main navigation' })
          .waitFor({ state: 'visible' });
        if (viewport.width >= 768) await page.keyboard.press('Escape');
        else
          await page
            .getByRole('button', { name: 'Close navigation', exact: true })
            .tap();
        await page.locator('#email').scrollIntoViewIfNeeded();
        // Native previews stay dark across live system theme changes.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const previewBody = page
          .locator('#email .homepage-email-body p')
          .first();
        await expect(previewBody).toHaveCSS('opacity', '1');
        await expect(previewBody).toHaveText(/\S+/);
        await expect(previewBody).toHaveCSS('color', 'rgb(255, 255, 255)');
        await page.emulateMedia({
          colorScheme: colorScheme === 'light' ? 'dark' : 'light',
        });
        await expect(previewBody).toHaveCSS('color', 'rgb(255, 255, 255)');
        await page.emulateMedia({ colorScheme });
        const overflow = await page
          .locator('[data-onboarding-scroll]')
          .evaluate((scroller) => scroller.scrollWidth > scroller.clientWidth);
        expect(overflow).toBe(false);
        if (viewport.width >= 700) {
          const graphic = await page
            .locator('.homepage-feature-links .feature-flow')
            .boundingBox();
          expect(graphic).not.toBeNull();
          expect(graphic!.x).toBeGreaterThanOrEqual(0);
          expect(graphic!.x + graphic!.width).toBeLessThanOrEqual(
            viewport.width
          );
        }
        await page
          .locator('#email')
          .getByRole('link', { name: 'Learn about email', exact: true })
          .click();
        await expect(page).toHaveURL(`${origin}/email`);
        await page.goBack();
        await page.locator('.homepage-hero-cta').click();
        await expect(page).toHaveURL(
          `${origin}${viewport.width < 640 ? '/mobile-signup' : '/app/signup'}`
        );
        if (errors.length)
          throw new Error(
            `Homepage demo failed (${label}): ${errors.join('; ')}`
          );
        console.log(
          `[prerender] Homepage ${label}: SSR content, responsive hydration, navigation, feature links, animation, and signup routing verified`
        );
      } finally {
        releaseScripts();
        await page.close();
      }
    }
    if (browserType === chromium) await verifyProductPages(browser, origin);
  } finally {
    await browser?.close();
    server.stop(true);
  }
}
