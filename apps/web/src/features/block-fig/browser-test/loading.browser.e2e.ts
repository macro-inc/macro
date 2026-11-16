import { expect, test } from '@playwright/test';

test('opening preserves canvas geometry without a thumbnail pop', async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  // The binary itself; in dev, `?import` requests are the module that exports its URL.
  const binary = (url: URL) =>
    url.pathname.endsWith('/fig_engine_bg.wasm') &&
    !url.searchParams.has('import');
  await page.route(binary, async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto('/?file=showcase.fig');
  try {
    const opening = page.getByTestId('fig-opening');
    await expect(opening).toBeVisible();
    await expect(opening.locator('img')).toHaveCount(0);
    await expect(opening.getByRole('status')).toHaveText('Opening design…');
    const before = await page.getByTestId('fig-opening-canvas').boundingBox();
    expect(before).not.toBeNull();
    release();
    await expect(page.getByTestId('fig-viewer')).toBeVisible();
    await expect(page.getByTestId('fig-loading-status')).toHaveCount(0);
    const after = await page.getByTestId('fig-canvas').boundingBox();
    expect(after).toEqual(before);
    expect(await page.evaluate(() => window.figFixture.errors())).toEqual([]);
  } finally {
    release();
  }
});

test('an empty design does not wait forever for a rendered tile', async ({
  page,
}) => {
  await page.goto('/?new&edit');
  await expect(page.getByTestId('fig-viewer')).toBeVisible();
  await expect(page.getByTestId('fig-loading-status')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Frame (F)', exact: true })
  ).toBeEnabled();
});
