import { expect, type Page, test } from '@playwright/test';

const canvas = (page: Page) =>
  page.evaluate(() => {
    const { editor, copiedLinks } = window.canvasTouchFixture;
    return {
      selectedIds: editor.getSession().selectedIds,
      scale: editor.getCamera().scale,
      copiedLinks: [...copiedLinks],
    };
  });

/** Whether an item lies wholly inside the visible part of the page. */
async function inView(page: Page, itemId: string) {
  const box = await page
    .locator(`[data-graphics-item="${itemId}"]`)
    .boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) return false;
  return (
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.width <= viewport.width &&
    box.y + box.height <= viewport.height
  );
}

test.beforeEach(({ isMobile }) => {
  test.skip(!isMobile, 'The fixture is the touch view');
});

test('a link to an item opens the canvas with that item selected and framed', async ({
  page,
}) => {
  await page.goto('/touch.html?item=outline');
  await expect(page.getByLabel('Drawing tools')).toBeVisible();

  await expect
    .poll(async () => (await canvas(page)).selectedIds)
    .toEqual(['outline']);
  expect((await canvas(page)).scale).not.toBe(1);
  expect(await inView(page, 'outline')).toBe(true);
});

test('following a link while the canvas is open frames the newly linked item', async ({
  page,
}) => {
  await page.goto('/touch.html?item=outline');
  await expect
    .poll(async () => (await canvas(page)).selectedIds)
    .toEqual(['outline']);

  await page.evaluate(() => window.canvasTouchFixture.focus('filled'));
  await expect
    .poll(async () => (await canvas(page)).selectedIds)
    .toEqual(['filled']);
  expect(await inView(page, 'filled')).toBe(true);

  // The same link again frames its item again after the view has moved.
  await page.evaluate(() => {
    const { editor } = window.canvasTouchFixture;
    editor.select();
    editor.panBy({ x: 2000, y: 0 });
  });
  expect(await inView(page, 'filled')).toBe(false);
  await page.evaluate(() => window.canvasTouchFixture.focus('filled'));
  await expect.poll(() => inView(page, 'filled')).toBe(true);
  expect((await canvas(page)).selectedIds).toEqual(['filled']);
});

test('a link to an item the canvas no longer has leaves the view alone', async ({
  page,
}) => {
  await page.goto('/touch.html?item=deleted-item');
  await expect(page.getByLabel('Drawing tools')).toBeVisible();

  const state = await canvas(page);
  expect(state.selectedIds).toEqual([]);
  expect(state.scale).toBe(1);
});

test('More copies a link to the one selected item', async ({ page }) => {
  await page.goto('/touch.html');
  await expect(page.getByLabel('Drawing tools')).toBeVisible();
  const box = await page.locator('[data-graphics-item="filled"]').boundingBox();
  if (!box) throw new Error('The filled rectangle is not rendered');

  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole('button', { name: 'More actions' }).tap();
  const sheet = page.getByRole('dialog', { name: 'Canvas actions' });
  await sheet.getByRole('button', { name: 'Copy link to element' }).tap();

  await expect
    .poll(async () => (await canvas(page)).copiedLinks)
    .toEqual(['filled']);
});
