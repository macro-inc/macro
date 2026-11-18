import { expect, type Page, test } from '@playwright/test';

// What a single finger can check, so that it also runs in WebKit, the engine
// of Safari and the iOS app. Two-finger gestures need Chromium's CDP and live
// in the other touch specs.

const canvas = (page: Page) =>
  page.evaluate(() => {
    const { editor } = window.canvasTouchFixture;
    const { selectedIds } = editor.getSession();
    return { selectedIds, scale: editor.getCamera().scale };
  });

test.beforeEach(async ({ page }) => {
  await page.goto('/touch.html');
  await expect(page.getByLabel('Drawing tools')).toBeVisible();
});

test('the drawing tools sit above the dock, each a finger wide and tall', async ({
  page,
}) => {
  const dock = await page.getByTestId('dock').boundingBox();
  const tools = page.getByLabel('Drawing tools').getByRole('button');
  if (!dock) throw new Error('The dock is not rendered');
  expect(await tools.count()).toBeGreaterThanOrEqual(8);
  for (const tool of await tools.all()) {
    const box = await tool.boundingBox();
    if (!box) throw new Error('A tool is not rendered');
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(40);
    expect(box.y + box.height).toBeLessThanOrEqual(dock.y);
  }
});

test('a tap selects a shape and shows its actions; a tap on nothing clears them', async ({
  page,
}) => {
  const shape = await page
    .locator('[data-graphics-item="filled"]')
    .boundingBox();
  if (!shape) throw new Error('The filled rectangle is not rendered');
  await page.touchscreen.tap(
    shape.x + shape.width / 2,
    shape.y + shape.height / 2
  );
  expect((await canvas(page)).selectedIds).toEqual(['filled']);
  const actions = page.getByLabel('Selection actions');
  await expect(actions.getByRole('button', { name: 'Delete' })).toBeVisible();

  await page.touchscreen.tap(shape.x + shape.width + 120, shape.y - 60);
  expect((await canvas(page)).selectedIds).toEqual([]);
  await expect(actions).toHaveCount(0);
});

test('a tap near the stroke of an outlined shape selects it', async ({
  page,
}) => {
  const box = await page
    .locator('[data-graphics-item="outline"]')
    .boundingBox();
  if (!box) throw new Error('The outlined ellipse is not rendered');

  await page.touchscreen.tap(box.x + 8, box.y + box.height / 2);

  expect((await canvas(page)).selectedIds).toEqual(['outline']);
});

test('the zoom sheet zooms and fits', async ({ page }) => {
  await page.getByRole('button', { name: 'Zoom options' }).tap();
  const sheet = page.getByRole('dialog', { name: 'View' });
  // Sheet rows follow the system text size, which this engine sets smaller
  // than a phone does, so their height is checked in the Chromium specs.
  await sheet.getByRole('menuitemcheckbox', { name: 'Zoom to 200%' }).tap();
  await expect.poll(async () => (await canvas(page)).scale).toBe(2);

  await page.getByRole('button', { name: 'Zoom options' }).tap();
  await sheet.getByRole('button', { name: 'Zoom to fit' }).tap();
  await expect.poll(async () => (await canvas(page)).scale).not.toBe(2);
});

test('Attach opens its sheet, and Media its picker sheet', async ({ page }) => {
  await page.getByRole('button', { name: 'Attach' }).tap();
  const rows = page.getByRole('dialog', { name: 'Attach' });
  await expect(
    rows.getByRole('button', { name: 'Upload media' })
  ).toBeVisible();

  await rows.getByRole('button', { name: 'Media', exact: true }).tap();

  await expect(
    page.getByRole('dialog', { name: 'Insert media' })
  ).toBeVisible();
  await expect(rows).toBeHidden();
});
