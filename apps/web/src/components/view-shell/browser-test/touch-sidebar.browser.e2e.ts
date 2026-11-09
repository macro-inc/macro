import { expect, test } from '@playwright/test';

test.use({ hasTouch: true });

test('collapses beside the view title and reopens before touch filters', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto('/src/components/view-shell/browser-test/touch-sidebar.html');
  const navigation = page.getByRole('complementary', {
    name: 'Workspace navigation',
  });
  const collapse = page.getByRole('button', { name: 'Hide navigation' });
  await expect(navigation).toBeVisible();
  await expect(collapse).toBeVisible();
  const title = await navigation
    .getByRole('heading', { name: 'Drive' })
    .boundingBox();
  const button = await collapse.boundingBox();
  expect(button!.x).toBeGreaterThan(title!.x + title!.width);
  expect(
    Math.abs(button!.y + button!.height / 2 - title!.y - title!.height / 2)
  ).toBeLessThan(1);

  await collapse.tap();
  const expand = page.getByRole('button', { name: 'Show navigation' });
  await expect(expand).toBeVisible();
  const expandBox = await expand.boundingBox();
  const filterBox = await page
    .getByRole('button', { name: 'Filters', exact: true })
    .boundingBox();
  expect(expandBox!.x + expandBox!.width).toBeLessThan(filterBox!.x);
  await expand.tap();
  await expect(collapse).toBeVisible();
  await expect(collapse).toBeFocused();
  await page.getByRole('button', { name: 'Recent', exact: true }).tap();
  await expect(page.getByText('Selected: recent')).toBeVisible();

  await collapse.tap();
  await page.reload();
  await expect(expand).toBeVisible();
});

test('uses the same width breakpoint on touch and retains the wide preference after folding', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto('/src/components/view-shell/browser-test/touch-sidebar.html');
  const expand = page.getByRole('button', { name: 'Show navigation' });
  const collapse = page.getByRole('button', { name: 'Hide navigation' });
  await expect(collapse).toBeVisible();
  await page.setViewportSize({ width: 600, height: 800 });
  await expect(expand).toBeVisible();
  await expand.tap();
  await expect(
    page.getByRole('button', { name: 'Close navigation backdrop' })
  ).toBeVisible();
  await collapse.tap();
  await expect(expand).toBeVisible();
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(collapse).toBeVisible();
  await collapse.tap();
  await page.setViewportSize({ width: 600, height: 800 });
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(expand).toBeVisible();
});
