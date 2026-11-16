import { expect, test } from '@playwright/test';
import { installBrowserHooks } from './browser-hooks';

installBrowserHooks('/?drag&second');

// The block handle writes only its editor's internal block key. In another editor with
// the app's drag handling (Source dragInsertPlugin; native createNativeEditorDrop) the
// drop fires and is consumed with its indicator hidden, but nothing there owns the key or
// can paste it: neither document changes. Runs for both engines (DRAG_ENGINE=native).
test('a block handle dropped into another editor changes neither document', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Load drag list', exact: true })
    .click();
  const body = page.locator('#body');
  const second = page.locator('#second');
  const blocks = body.locator(':scope > *');
  const before = await blocks.allInnerTexts();
  // Window capture runs before any editor handler, so editor propagation stops cannot
  // hide the drop.
  await page.evaluate(() => {
    window.addEventListener(
      'drop',
      (event) => {
        if (
          event.target instanceof Node &&
          document.getElementById('second')?.contains(event.target)
        ) {
          document.body.dataset.secondDrops = String(
            Number(document.body.dataset.secondDrops ?? 0) + 1
          );
        }
      },
      true
    );
  });
  await body.getByText('First item', { exact: true }).hover();
  const handle = page.locator('.draggable-block-menu');
  await expect(handle).toHaveAttribute('draggable', 'true');
  await handle.dragTo(second.locator('p'), {
    targetPosition: { x: 30, y: 10 },
  });
  await expect(page.locator('body')).toHaveAttribute('data-second-drops', '1');
  // Both fixtures render the real drag-insert indicator for the second editor.
  await expect(page.locator('.bg-accent\\/60.visible')).toHaveCount(0);
  await expect(second.locator('li')).toHaveCount(0);
  await expect(second).toHaveText('destination');
  expect(await blocks.allInnerTexts()).toEqual(before);
});
