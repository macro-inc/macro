import { expect, type Locator, type Page, test } from '@playwright/test';

async function placeCaretAtEnd(page: Page, index: number) {
  await page.getByRole('spinbutton', { name: 'Item' }).fill(String(index));
  await page.getByRole('button', { name: 'Select item text end' }).click();
}

/** Each top-level list item's value and whether an image sits inside it. */
function listOutline(editor: Locator) {
  return editor.evaluate((element) =>
    [...element.querySelectorAll(':scope > ol > li')].map((item) => ({
      value: item instanceof HTMLLIElement ? item.value : 0,
      text: item.textContent ?? '',
      images: item.querySelectorAll('[data-lexical-decorator]').length,
    }))
  );
}

test('images join list items without breaking the list or its numbering', async ({
  page,
  context,
}, testInfo) => {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (
      url.hostname === 'localhost' &&
      !url.pathname.includes('/__macro_dev/')
    ) {
      await route.continue();
    } else {
      await route.fulfill({ status: 401, body: '{}' });
    }
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(
    '/src/lib/core/component/LexicalMarkdown/component/core/browser-test/list-images.html'
  );
  const editor = page.getByRole('textbox', { name: 'Document' });
  await expect(editor).toBeVisible({ timeout: 60_000 });
  const items = editor.locator(':scope > ol > li');
  await expect(items).toHaveCount(3);

  // Insert with the caret in an item: the image goes under that item.
  await placeCaretAtEnd(page, 0);
  await page.getByRole('button', { name: 'Insert image' }).click();
  await expect(items.nth(0).locator('[data-lexical-decorator]')).toHaveCount(1);
  expect(await listOutline(editor)).toEqual([
    { value: 1, text: 'First step', images: 1 },
    { value: 2, text: 'Second step', images: 0 },
    { value: 3, text: 'Third step', images: 0 },
  ]);
  const image = await items.nth(0).locator('img').boundingBox();
  const text = await items.nth(0).locator('span').first().boundingBox();
  expect(image && text && image.y).toBeGreaterThan(text?.y ?? 0);
  expect(Math.abs((image?.x ?? 0) - (text?.x ?? 0))).toBeLessThan(2);

  // Enter after the item's text starts the next item below the image.
  await placeCaretAtEnd(page, 0);
  await page.keyboard.press('Enter');
  await page.keyboard.type('Between');
  expect(await listOutline(editor)).toEqual([
    { value: 1, text: 'First step', images: 1 },
    { value: 2, text: 'Between', images: 0 },
    { value: 3, text: 'Second step', images: 0 },
    { value: 4, text: 'Third step', images: 0 },
  ]);

  // On the empty item Enter leaves, an image joins the item above; a second
  // Enter leaves the list and the next image sits below it.
  await placeCaretAtEnd(page, 3);
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Insert image' }).click();
  await expect(items.nth(3).locator('[data-lexical-decorator]')).toHaveCount(1);
  await expect(items).toHaveCount(5);
  await placeCaretAtEnd(page, 4);
  await page.keyboard.press('Enter');
  await expect(items).toHaveCount(4);
  await page.getByRole('button', { name: 'Insert image' }).click();
  await expect(editor.locator(':scope > ol')).toHaveCount(1);
  await expect(
    editor.locator(':scope > ol [data-lexical-decorator]')
  ).toHaveCount(2);
  await expect(editor.locator('[data-lexical-decorator]')).toHaveCount(3);

  // A file dropped on an item's lower half joins that item.
  const second = await items.nth(2).boundingBox();
  if (!second) throw new Error('Missing second item');
  await editor.evaluate(
    (element, point) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([new Uint8Array([137, 80, 78, 71])], 'drop.png', {
          type: 'image/png',
        })
      );
      for (const type of ['dragover', 'drop']) {
        element.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: point.x,
            clientY: point.y,
            dataTransfer: transfer,
          })
        );
      }
    },
    { x: second.x + 20, y: second.y + second.height * 0.75 }
  );
  await expect(items.nth(2).locator('[data-lexical-decorator]')).toHaveCount(1);
  expect((await listOutline(editor)).map((item) => item.value)).toEqual([
    1, 2, 3, 4,
  ]);

  await page.getByRole('button', { name: 'Save' }).click();
  const markdown = await page.getByTestId('saved-markdown').textContent();
  expect(markdown).toMatch(/^1\. First step\n {3}!\[Screenshot\]\(data:/);
  const saved = page.getByTestId('saved');
  await expect(saved.locator('ol')).toHaveCount(1);
  await expect(saved.locator('ol img')).toHaveCount(2);

  await page.screenshot({
    path: testInfo.outputPath('list-images.png'),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
