import { expect, test } from '@playwright/test';
import { openFixture } from './serve-from-node';

// Real layout and native CSS snapping, not a synthesized touchmove or a jsdom timer.
test('native scrolling snaps, recenters, and retains five page nodes', async ({
  page,
}) => {
  await openFixture(page, '/snap-pager.html');
  const viewport = page.getByLabel('Native periods');
  await expect(page.getByLabel('Position')).toHaveText('0');
  await expect(viewport.locator('.snap-pager-page')).toHaveCount(5);
  await viewport.evaluate((element) =>
    element.scrollBy({ left: element.clientWidth * 0.8, behavior: 'smooth' })
  );
  await expect(page.getByLabel('Position')).toHaveText('1');
  await expect
    .poll(() =>
      viewport.evaluate((element) =>
        Math.abs(element.scrollLeft - 2 * element.clientWidth)
      )
    )
    .toBeLessThan(1);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByLabel('Position')).toHaveText('3');
  await page.getByRole('button', { name: 'Toggle lock' }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByLabel('Position')).toHaveText('3');
  await expect(viewport.locator('.snap-pager-page')).toHaveCount(5);
});
