import { expect, test } from '@playwright/test';

test('three rendered peers share drag edits, cursor/selection awareness, undo and reload', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Desktop pointer gesture coverage');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const alice = page.locator('[data-person="Alice"]');
  const bob = page.locator('[data-person="Bob"]');
  const viewer = page.locator('[data-person="Viewer"]');
  await expect(alice.getByLabel('Graphics canvas')).toBeVisible();
  await expect(bob.getByLabel('Graphics canvas')).toBeVisible();
  await expect(viewer.getByLabel('Graphics canvas')).toBeVisible();
  const bounds = (await alice.getByLabel('Graphics canvas').boundingBox())!;
  await page.mouse.move(bounds.x + 130, bounds.y + 140);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 180, bounds.y + 160, { steps: 5 });
  await expect(bob.locator('[data-presence-cursor]')).toHaveCount(1);
  await expect(bob.locator('[data-presence-preview="box"]')).toBeVisible();
  await page.mouse.up();
  await expect(bob.locator('[data-presence-selection]')).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const box =
          window.canvasFixture.people.get('Bob')!.editor.document.items.box;
        return box?.type === 'rectangle' ? box.transform[4] : undefined;
      })
    )
    .toBe(130);
  await page.evaluate(async () => {
    const bob = window.canvasFixture.people.get('Bob')!;
    bob.editor.select('box');
    bob.editor.setSelectionAppearance({ fill: 'red' });
    await bob.session.flush();
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const box =
          window.canvasFixture.people.get('Viewer')!.editor.document.items.box;
        return box?.type === 'rectangle' ? box.appearance.fill : undefined;
      })
    )
    .toBe('red');
  await page.evaluate(async () => {
    const alice = window.canvasFixture.people.get('Alice')!;
    alice.editor.undo();
    await alice.session.flush();
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const box =
          window.canvasFixture.people.get('Bob')!.editor.document.items.box;
        return box?.type === 'rectangle'
          ? { x: box.transform[4], fill: box.appearance.fill }
          : undefined;
      })
    )
    .toEqual({ x: 80, fill: 'red' });
  await page.evaluate(() => window.canvasFixture.reopen('Alice'));
  await expect(alice.getByLabel('Graphics canvas')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const box =
          window.canvasFixture.people.get('Alice')?.editor.document.items.box;
        return box?.type === 'rectangle' ? box.appearance.fill : undefined;
      })
    )
    .toBe('red');
  await page.mouse.move(bounds.x + 140, bounds.y + 200);
  await expect(bob.locator('[data-presence-cursor]')).toHaveCount(1);
  await page.screenshot({
    path: '/tmp/canvas-multiplayer.png',
    fullPage: true,
  });
  await page.mouse.move(0, 0);
  await expect(bob.locator('[data-presence-cursor]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('touch selection is visible to other editors and viewers', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Touch input coverage');
  await page.goto('/');
  const alice = page
    .locator('[data-person="Alice"]')
    .getByLabel('Graphics canvas');
  await expect(alice).toBeVisible();
  await expect(
    page.locator('[data-person="Bob"]').getByLabel('Graphics canvas')
  ).toBeVisible();
  const bounds = (await alice.boundingBox())!;
  await page.touchscreen.tap(bounds.x + 100, bounds.y + 130);
  await expect(
    page.locator('[data-person="Bob"] [data-presence-selection]')
  ).toHaveCount(1);
  await expect(
    page.locator('[data-person="Viewer"] [data-presence-selection]')
  ).toHaveCount(1);
});
