import { expect, type Page, test } from '@playwright/test';
import { fitRect, pageToScreen } from '../core/camera';

async function drawFrame(page: Page) {
  await page.goto('/?new');
  const canvas = page.getByTestId('fig-canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas missing');
  await canvas.focus();
  await page.keyboard.press('f');
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 300, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByTestId('fig-name')).toHaveValue('Frame 1');
  return { x: box.x + 110, y: box.y + 88 };
}

test('canvas frame labels select, rename, cancel and undo', async ({
  page,
}) => {
  const label = await drawFrame(page);
  await page.keyboard.press('Escape');
  await page.mouse.click(label.x, label.y);
  await expect(page.getByTestId('fig-name')).toHaveValue('Frame 1');
  await page.mouse.dblclick(label.x, label.y);
  const input = page.getByTestId('fig-frame-rename');
  await expect(input).toBeFocused();
  expect(
    await input.evaluate((el: HTMLInputElement) => [
      el.selectionStart,
      el.selectionEnd,
    ])
  ).toEqual([0, 7]);
  await input.fill('Inbox');
  await input.press('Enter');
  await expect(input).toBeHidden();
  await expect(page.getByTestId('fig-name')).toHaveValue('Inbox');
  await expect(
    page.getByTestId('fig-layer-row').filter({ hasText: 'Inbox' })
  ).toBeVisible();
  await page.mouse.dblclick(label.x, label.y);
  await input.fill('Cancelled name');
  await input.press('Escape');
  await expect(page.getByTestId('fig-name')).toHaveValue('Inbox');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('fig-name')).toHaveValue('Frame 1');
  await page.mouse.dblclick(label.x, label.y);
  await input.fill('Saved on blur');
  await page.getByTestId('fig-name').click();
  await expect(
    page.getByTestId('fig-layer-row').filter({ hasText: 'Saved on blur' })
  ).toBeVisible();
  expect(await page.evaluate(() => window.figFixture.errors())).toEqual([]);
});

test('read-only labels select frames without opening a name editor', async ({
  page,
}) => {
  await page.goto('/?file=showcase.fig');
  const canvas = page.getByTestId('fig-canvas');
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId('fig-layer-row')).toHaveCount(2);
  await canvas.focus();
  await page.keyboard.press('Shift+1');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas missing');
  const layout = await page.evaluate(() =>
    window.figFixture.engine()!.openPage(0)
  );
  const home = layout.frames.find((frame) => frame.name === 'Home')!;
  const camera = fitRect(layout.bounds, { w: box.width, h: box.height }, 1);
  const point = pageToScreen(camera, home.bounds);
  await page.mouse.click(box.x + point.x + 10, box.y + point.y - 12);
  const row = page.locator(`[data-layer-id="${home.id}"]`);
  await expect(row).toHaveClass(/bg-accent\/20/);
  await page.mouse.dblclick(box.x + point.x + 10, box.y + point.y - 12);
  await expect(page.getByTestId('fig-frame-rename')).toHaveCount(0);
  await expect(row).toHaveClass(/bg-accent\/20/);
});

test('dragging a frame label moves its frame', async ({ page }) => {
  const label = await drawFrame(page);
  const id = await page
    .getByTestId('fig-layer-row')
    .first()
    .getAttribute('data-layer-id');
  if (!id) throw new Error('Frame missing');
  const before = await page.evaluate(
    (id) => window.figFixture.engine()!.nodeInfo(0, id),
    id
  );
  await page.mouse.move(label.x, label.y);
  await page.mouse.down();
  await page.mouse.move(label.x + 50, label.y + 50, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const after = await page.evaluate(
        (id) => window.figFixture.engine()!.nodeInfo(0, id),
        id
      );
      return [after.x - before.x, after.y - before.y];
    })
    .toEqual([50, 50]);
});
