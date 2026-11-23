import path from 'node:path';
import { chromium, expect, type Page } from '@playwright/test';
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

        await expect(page.locator('.feature-page-section')).toHaveCount(12);
        if (viewport.width < 768) {
          await expect(page.locator('#pricing')).toBeVisible();
          await expect(page.locator('.homepage-modules a[href]')).toHaveCount(
            12
          );
        } else {
          await expect(page.locator('#pricing')).toBeHidden();
        }
        await expect(page.locator('#app-scroll-root')).toHaveCSS(
          'background-color',
          'rgb(0, 0, 0)'
        );

        // Lazy section styles must also be linked before hydration.
        await expect(page.locator('#email .homepage-screen')).toHaveCSS(
          'overflow',
          'hidden'
        );
        await expect(page.locator('#email-title')).toHaveCSS(
          'font-family',
          /Roboto Slab Variable/
        );

        // The product tour must keep the app window's shape before scripts run.
        await expect(page.locator('.homepage-tour-screen')).toHaveCSS(
          'aspect-ratio',
          '1700 / 916'
        );
        await expect(
          page.locator('.homepage-tour-screen img[data-active="true"]')
        ).toHaveCount(1);
        await expect(headingLocator).toHaveCSS(
          'font-family',
          /Roboto Slab Variable/
        );

        releaseScripts();
        await page.waitForLoadState('load');
        if (errors.length)
          throw new Error(
            `Homepage hydration failed (${label}): ${errors.join('; ')}`
          );
        await page.waitForSelector(
          '#root[data-public-ready="true"] .feature-page-section',
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
        await expect(page.locator('.homepage-hero-cta')).toBeVisible();
        await heading.dispose();

        // The tour responds once hydrated: Next selects the following module.
        await page.getByRole('button', { name: 'Next module' }).click();
        await expect(
          page.getByRole('tab', { name: 'Mail', exact: true })
        ).toHaveAttribute('aria-selected', 'true');

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
        // The page stays dark across live system theme changes.
        const emailTitle = page.locator('#email-title');
        await expect(page.locator('#email .homepage-screen img')).toBeVisible();
        const titleColor = await emailTitle.evaluate(
          (element) => getComputedStyle(element).color
        );
        await page.emulateMedia({
          colorScheme: colorScheme === 'light' ? 'dark' : 'light',
        });
        await expect(emailTitle).toHaveCSS('color', titleColor);
        await page.emulateMedia({ colorScheme });
        const overflow = await page
          .locator('[data-onboarding-scroll]')
          .evaluate((scroller) => scroller.scrollWidth > scroller.clientWidth);
        expect(overflow).toBe(false);
        const graphic = await page.locator('.homepage-tour').boundingBox();
        if (!graphic)
          throw new Error(`Homepage has no product tour (${label})`);
        expect(graphic.x).toBeGreaterThanOrEqual(0);
        expect(graphic.x + graphic.width).toBeLessThanOrEqual(viewport.width);
        await page
          .locator('#email')
          .getByRole('link', { name: 'Learn about email', exact: true })
          .click();
        await expect(page).toHaveURL(`${origin}/email`);
        await verifySignupNavigation(page, origin, viewport.width < 640);
        if (errors.length)
          throw new Error(
            `Homepage demo failed (${label}): ${errors.join('; ')}`
          );
        console.log(
          `[prerender] Homepage ${label}: SSR content, responsive hydration, navigation, product tour, section links, and signup routing verified`
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

async function verifySignupNavigation(
  page: Page,
  origin: string,
  phone: boolean
): Promise<void> {
  // App signup belongs to a separate application. A URL change alone
  // can pass while the website router renders an empty shell.
  await page.route(`${origin}/app/signup`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<h1>Signup application</h1>',
    })
  );
  const signupUrl = `${origin}${phone ? '/mobile-signup' : '/app/signup'}`;
  for (const selector of [
    '.homepage-hero-cta',
    '.site-header-actions .site-nav-start',
  ]) {
    await page.goBack();
    const [response] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url() === signupUrl &&
          response.request().isNavigationRequest()
      ),
      page.locator(selector).click(),
    ]);
    expect(response.ok()).toBe(true);
    await expect(page).toHaveURL(signupUrl);
    if (!phone)
      await expect(
        page.getByRole('heading', { name: 'Signup application' })
      ).toBeVisible();
  }
}
