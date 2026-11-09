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
  const controls = await page.evaluate(() => {
    const expand = document.querySelector<HTMLButtonElement>(
      '[data-view-sidebar-toggle="expand"]'
    );
    const filters = document.querySelector<HTMLButtonElement>(
      '[aria-label="Filters"]'
    );
    if (!expand || !filters) throw new Error('Touch controls are missing');
    // Measure together while the sidebar's close animation moves the pane.
    return {
      expandRight: expand.getBoundingClientRect().right,
      filterLeft: filters.getBoundingClientRect().left,
    };
  });
  expect(controls.expandRight).toBeLessThan(controls.filterLeft);
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

test('phone Chat has no navigation row or extra gap and wide Chat retains sidebar controls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    '/src/components/view-shell/browser-test/touch-sidebar.html?channels'
  );
  const expand = page.getByRole('button', { name: 'Show navigation' });
  await expect(expand).toBeHidden();
  const scroller = page.getByTestId('channel-scroll');
  const shell = page.locator('[data-view-shell-main]');
  const scrollBox = await scroller.boundingBox();
  const shellBox = await shell.boundingBox();
  expect(scrollBox!.y).toBe(shellBox!.y);
  expect(scrollBox!.height).toBe(shellBox!.height);
  const first = scroller.locator('[data-channel-row="0"]');
  expect((await first.boundingBox())!.y).toBe(scrollBox!.y);
  await scroller.evaluate((element) => {
    element.scrollTop = 80;
  });
  expect((await first.boundingBox())!.y).toBeLessThan(scrollBox!.y);
  await page.setViewportSize({ width: 1000, height: 844 });
  await page.getByRole('button', { name: 'Hide navigation' }).tap();
  await expect(expand).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(expand).toBeHidden();
  await page.setViewportSize({ width: 1000, height: 844 });
  await expect(expand).toBeVisible();
});
