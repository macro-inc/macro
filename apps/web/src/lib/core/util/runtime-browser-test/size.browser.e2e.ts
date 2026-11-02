import { expect, test } from '@playwright/test';

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`delivers border-box size before first content paint at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const original = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function () {
        throw new Error('Fixture must not synchronously read layout');
      };
      // Retain the browser's implementation only for Playwright's input work.
      document.addEventListener('restore-layout-reads', () => {
        Element.prototype.getBoundingClientRect = original;
      });
    });
    await page.goto('/size.html');
    const size = page.locator('#size');
    await expect(size).toHaveAttribute(
      'data-width',
      String(viewport.width / 2 + 44)
    );
    await expect(size).toHaveAttribute('data-height', '164');
    await expect(size).toHaveAttribute(
      'data-layout',
      viewport.width > 1000 ? 'wide' : 'narrow'
    );
    await expect
      .poll(() =>
        page.evaluate(
          () => performance.getEntriesByName('first-contentful-paint').length
        )
      )
      .toBe(1);
    const timing = await page.evaluate(() => ({
      measured: Number(document.body.dataset.firstMeasurement),
      painted: performance.getEntriesByName('first-contentful-paint')[0]
        .startTime,
    }));
    expect(timing.measured).toBeLessThanOrEqual(timing.painted);
    await page.evaluate(() =>
      document.dispatchEvent(new Event('restore-layout-reads'))
    );
    await page.getByRole('button', { name: 'Grow border' }).click();
    await expect(size).toHaveAttribute(
      'data-width',
      String(viewport.width / 2 + 56)
    );
    await expect(size).toHaveAttribute('data-height', '176');
    expect(errors).toEqual([]);
  });
}
