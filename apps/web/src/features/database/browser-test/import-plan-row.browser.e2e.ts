import { expect, test } from '@playwright/test';

for (const phone of [true, false]) {
  test(`import row names and controls fit ${phone ? 'a phone' : 'desktop'}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: phone ? 390 : 1280, height: 800 },
      isMobile: phone,
      hasTouch: phone,
    });
    const page = await context.newPage();
    try {
      // This fixture renders only the production row and styles, never a backend.
      await page.route('**/*', (route) => {
        const url = new URL(route.request().url());
        return url.origin ===
          new URL(test.info().project.use.baseURL!).origin &&
          !/^\/(cognition|api|graphql|auth)(\/|$)/.test(url.pathname)
          ? route.continue()
          : route.fulfill({ status: 404, body: '' });
      });
      await page.goto(
        '/src/features/database/browser-test/import-plan-row.html'
      );
      for (const label of ['Thread card', 'Full review sheet']) {
        const region = page.getByRole('region', { name: label });
        const title = region.getByText('Engineering Handbook plan', {
          exact: true,
        });
        await expect(title).toBeVisible({ timeout: 60_000 });
        await page.evaluate(() => document.fonts.ready);
        await expect(region.getByRole('checkbox')).toBeVisible();
        const sharing = region.getByRole('button', {
          name: 'Share Engineering Handbook plan with your team',
        });
        await expect(sharing).toBeVisible();
        const geometry = await title.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(element);
          return {
            whitespace: getComputedStyle(element).whiteSpace,
            overflow: getComputedStyle(element).textOverflow,
            top: box.top,
            bottom: box.bottom,
            allTextFits: [...range.getClientRects()].every(
              (part) =>
                part.left >= box.left - 1 &&
                part.right <= box.right + 1 &&
                part.top >= box.top - 1 &&
                part.bottom <= box.bottom + 1
            ),
          };
        });
        const badge = await sharing.boundingBox();
        expect(badge).not.toBeNull();
        if (phone) {
          expect(geometry.whitespace).toBe('normal');
          expect(geometry.allTextFits).toBe(true);
          expect(badge!.y).toBeGreaterThanOrEqual(geometry.bottom);
        } else {
          expect(geometry.whitespace).toBe('nowrap');
          expect(geometry.overflow).toBe('ellipsis');
          expect(badge!.y).toBeLessThan(geometry.bottom);
          expect(badge!.y + badge!.height).toBeGreaterThan(geometry.top);
        }
      }
      await page.screenshot({
        path: test
          .info()
          .outputPath(
            phone ? 'phone-import-rows.png' : 'desktop-import-rows.png'
          ),
      });
    } finally {
      await context.close();
    }
  });
}
