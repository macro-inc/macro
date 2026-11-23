import { type Browser, expect } from '@playwright/test';

/** Check each product page's first paint and real app screens in the built site. */
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
    '/forms',
    '/spreadsheets',
    '/databases',
    '/drive',
    '/calendar',
    '/booking-links',
    '/canvas',
    '/snippets',
    '/routines',
    '/skills',
  ]) {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      reducedMotion: 'reduce',
      colorScheme: 'dark',
    });
    let releaseScripts!: () => void;
    const scriptsReady = new Promise<void>((resolve) => {
      releaseScripts = resolve;
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', async (request) => {
      if (new URL(request.request().url()).origin !== origin)
        await request.abort();
      else {
        if (request.request().resourceType() === 'script') await scriptsReady;
        await request.continue();
      }
    });
    try {
      await page.goto(`${origin}${route}`, { waitUntil: 'commit' });
      const heading = page.locator('.feature-page-hero h1');
      await expect(heading).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      // These must hold before route JavaScript can repair missing CSS. A
      // stale prerender asset entry previously painted a 1000px brand SVG.
      const brand = page.locator('.product-home-link > svg');
      const initialBrand = await brand.boundingBox();
      expect(initialBrand?.width, `${route}: first-paint logo width`).toBe(20);
      expect(initialBrand?.height, `${route}: first-paint logo height`).toBe(
        20
      );
      await expect(heading).toHaveCSS('font-family', /Roboto Slab/);
      const padding = await page
        .locator('.email-page-hero')
        .evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).paddingTop)
        );
      expect(
        padding,
        `${route}: hero styled before JavaScript`
      ).toBeGreaterThan(100);
      releaseScripts();
      await page.waitForLoadState('load');
      await expect(brand).toHaveAttribute('width', '20');
      await expect(brand).toHaveAttribute('height', '20');
      // Each feature section shows a real app screen, sized before it loads.
      const screens = page.locator('.feature-screenshot img:visible');
      const count = await screens.count();
      expect(count, `${route}: app screens are present`).toBeGreaterThan(0);
      for (let index = 0; index < count; index++) {
        const box = await screens.nth(index).boundingBox();
        expect(
          box?.height,
          `${route}: screen ${index} keeps its height`
        ).toBeGreaterThan(100);
      }
      // The outlined part of each screen starts fully in view on a phone.
      const clipped = await page.evaluate(() =>
        [...document.querySelectorAll('.feature-screenshot-focus')]
          .filter((focus) => focus.getClientRects().length > 0)
          .filter((focus) => {
            const frame = focus
              .closest('.feature-screenshot-viewport')
              ?.getBoundingClientRect();
            const box = focus.getBoundingClientRect();
            return (
              !frame || box.left < frame.left - 1 || box.right > frame.right + 1
            );
          })
          .map((focus) => focus.closest('section')?.id ?? '?')
      );
      expect(clipped, `${route}: outlines fit on a phone`).toEqual([]);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1
      );
      expect(overflow, `${route}: no page-level horizontal overflow`).toBe(
        false
      );
      expect(errors, `${route}: no browser errors`).toEqual([]);
      if (route === '/tasks') {
        await page.setViewportSize({ width: 1000, height: 844 });
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        const scroller = page.locator('#app-scroll-root');
        const appLink = page.locator('.site-header a.site-nav-start');
        const headerBounds = await appLink.boundingBox();
        await scroller.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        await expect(appLink).toHaveCount(1);
        expect(await appLink.boundingBox()).toEqual(headerBounds);
        await expect(page.locator('.homepage-closing-signup a')).toBeVisible();
        await scroller.evaluate((element) => {
          element.scrollTop = 0;
        });
        expect(await appLink.boundingBox()).toEqual(headerBounds);
      }
      console.log(
        `[prerender] ${route}: ${count} app screens render on a phone`
      );
    } finally {
      releaseScripts();
      await page.close();
    }
  }
}
