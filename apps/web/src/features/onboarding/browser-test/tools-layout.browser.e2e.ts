import { expect, test } from '@playwright/test';
import { heading, openFixture } from './fixture-page';

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 390, height: 667 },
  { width: 820, height: 1180 },
]) {
  test.describe(`${viewport.width}×${viewport.height} connector layout`, () => {
    test.use({ viewport, hasTouch: true });

    test('scrolls the page and keeps Continue reachable', async ({
      page,
    }, testInfo) => {
      await openFixture(page, '/?view=flow&theme=cream', {
        catalog: Array.from({ length: 24 }, (_, index) => ({
          slug: `tool-${index}`,
          name: `Tool ${index}`,
          iconUrl: null,
        })),
      });
      await page.evaluate(() =>
        sessionStorage.setItem(
          'onboarding-flow-step',
          JSON.stringify({ user: 'macro|ada@acme.com', step: 'tools' })
        )
      );
      await page.reload();
      await expect(heading(page, 'Connect your tools.')).toBeVisible();
      const next = page.getByRole('button', { name: 'Continue', exact: true });
      const catalog = page.getByRole('region', {
        name: 'Available integrations',
      });
      const scroller = page.locator('[data-onboarding-scroll]');
      await expect(next).toBeInViewport({ ratio: 1 });
      expect(
        await catalog.evaluate((el) => el.scrollHeight - el.clientHeight)
      ).toBe(0);
      await page.screenshot({ path: testInfo.outputPath('tools-top.png') });

      await catalog.getByRole('button').first().hover();
      await page.mouse.wheel(0, 350);
      await expect
        .poll(() => scroller.evaluate((el) => el.scrollTop))
        .toBeGreaterThan(0);
      expect(await catalog.evaluate((el) => el.scrollTop)).toBe(0);
      await expect(next).toBeInViewport({ ratio: 1 });

      await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight));
      const last = catalog.getByRole('button', {
        name: 'Connect Tool 23',
        exact: true,
      });
      await expect(last).toBeInViewport({ ratio: 1 });
      await last.tap();
      await expect(
        catalog.getByRole('button', {
          name: 'Connected to Tool 23',
          exact: true,
        })
      ).toBeDisabled();
      await expect(next).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: testInfo.outputPath('tools-bottom.png') });

      await page.getByRole('searchbox').fill('Tool 23');
      await expect(catalog.getByRole('button')).toHaveCount(1);
      await expect(next).toBeInViewport({ ratio: 1 });
      await page.getByRole('searchbox').fill('no results');
      await expect(page.getByText(/No integrations match/)).toBeVisible();
      await expect(next).toBeInViewport({ ratio: 1 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
      await next.tap();
      await expect(heading(page, 'Built for teams.')).toBeVisible();
    });
  });
}
