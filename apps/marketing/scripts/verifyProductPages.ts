import { type Browser, expect } from '@playwright/test';

/** Exercise touch entry and exit for every product demo in the built site. */
export async function verifyProductPages(browser: Browser, origin: string) {
  for (const route of [
    '/email',
    '/tasks',
    '/channels',
    '/documents',
    '/calls',
    '/crm',
    '/agents',
    '/github',
  ]) {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      reducedMotion: 'reduce',
      colorScheme: 'dark',
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', async (request) => {
      if (new URL(request.request().url()).origin !== origin)
        await request.abort();
      else await request.continue();
    });
    try {
      await page.goto(`${origin}${route}`, { waitUntil: 'load' });
      const heading = page.locator('.feature-page-hero h1');
      await expect(heading).toBeVisible();
      const demos = page.locator('.demo-interaction-boundary').filter({
        has: page.locator(':scope > .demo-interaction-activate'),
      });
      const count = await demos.count();
      expect(count, `${route}: product demos are present`).toBeGreaterThan(0);
      // All boundaries return to preview mode after tapping the heading, so
      // their order stays stable while the deferred demo content loads.
      for (let index = 0; index < count; index++) {
        const demo = demos.nth(index);
        const boundary = await demo.elementHandle();
        if (!boundary) throw new Error(`${route}: demo ${index} disappeared`);
        await demo.locator(':scope > .demo-interaction-activate').tap();
        // Hold the clicked boundary: activation removes its entry button.
        expect(await boundary.getAttribute('data-demo-active')).toBe('true');
        expect(
          await boundary.evaluate((element) =>
            element
              .querySelector(':scope > .demo-interaction-content')
              ?.hasAttribute('inert')
          )
        ).toBe(false);
        await heading.tap();
        await expect(
          page.locator(
            '.demo-interaction-boundary[data-demo-interacted="true"][data-demo-active="true"]'
          )
        ).toHaveCount(0);
        await boundary.dispose();
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1
      );
      expect(overflow, `${route}: no page-level horizontal overflow`).toBe(
        false
      );
      expect(errors, `${route}: no browser errors`).toEqual([]);
      if (route === '/tasks') {
        await page.setViewportSize({ width: 1000, height: 844 });
        await page.evaluate(() => document.fonts.ready);
        const lines = await page
          .locator('.email-page-hero-description')
          .evaluate(
            (element) =>
              element.clientHeight /
              Number.parseFloat(getComputedStyle(element).lineHeight)
          );
        expect(
          lines,
          'Tasks desktop subheading stays on its two intended lines'
        ).toBeCloseTo(2, 1);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        const scroller = page.locator('#app-scroll-root');
        await scroller.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        const appLink = page.locator('.site-header a.site-nav-open');
        await expect(appLink).toHaveCount(1);
        await expect(appLink).toHaveAttribute('data-cta-footer', '');
        await expect
          .poll(() =>
            page.locator('.site-nav-open-footer').evaluate((element) => {
              const textSize = Number.parseFloat(
                getComputedStyle(element).fontSize
              );
              const matrix = new DOMMatrixReadOnly(
                getComputedStyle(element.parentElement!).transform
              );
              return textSize > 24 && matrix.a === 1;
            })
          )
          .toBe(true);
        await scroller.evaluate((element) => {
          element.scrollTop = 0;
        });
        await expect(appLink.locator('.site-nav-open-label')).toHaveCSS(
          'opacity',
          '1'
        );
        await expect(appLink.locator('.site-nav-open-footer')).toHaveCSS(
          'font-size',
          '16px'
        );
      }
      console.log(
        `[prerender] ${route}: ${count} mobile demos accept touch entry and return to page scrolling`
      );
    } finally {
      await page.close();
    }
  }
}
