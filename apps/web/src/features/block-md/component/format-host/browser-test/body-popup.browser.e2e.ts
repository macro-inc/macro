import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const formats = [
  { label: 'Bold', selector: 'strong,b' },
  { label: 'Italic', selector: 'em,i' },
  { label: 'Underline', selector: '.md-underline,u' },
  { label: 'Strikethrough', selector: '.md-strike,s' },
  { label: 'Highlight', selector: 'mark' },
  { label: 'Inline code', selector: 'code' },
  { label: 'Superscript', selector: 'sup' },
  { label: 'Subscript', selector: 'sub' },
];

test('body popup uses real FormatTools order and all six More actions on the actual selection', async ({
  page,
}, info) => {
  const errors: string[] = [];
  const wasm: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('requestfinished', (request) => {
    const url = new URL(request.url());
    if (!url.pathname.endsWith('.wasm')) return;
    const build = process.env.NATIVE_FORMAT_BUILD;
    if (!build) throw new Error('Missing owned build');
    wasm.push(
      createHash('sha256')
        .update(readFileSync(join(build, 'dist', url.pathname)))
        .digest('hex')
    );
  });
  await page.goto('/?body');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  const body = page.locator('#body');
  await body.focus();
  await body.evaluate((root) => {
    const text = document
      .createTreeWalker(root, NodeFilter.SHOW_TEXT)
      .nextNode();
    if (!text) throw new Error('Missing actual native text');
    root.ownerDocument.getSelection()?.setBaseAndExtent(text, 0, text, 18);
  });
  const toolbar = page.getByRole('toolbar', { name: 'Document selection' });
  await expect(toolbar).toBeVisible();
  const group = toolbar.locator('div.flex.h-full.items-center.gap-1');
  const inventory = await group.getByRole('button').evaluateAll((buttons) =>
    buttons.map((button) => ({
      label: button.getAttribute('aria-label') || button.textContent?.trim(),
      x: button.getBoundingClientRect().x,
      y: button.getBoundingClientRect().y,
      height: button.getBoundingClientRect().height,
    }))
  );
  expect(inventory.map((button) => button.label)).toEqual([
    'Bold',
    'Italic',
    '',
    'Body',
  ]);
  expect(
    inventory.every(
      (button) =>
        Math.abs(button.y - inventory[0].y) < 1 &&
        Math.abs(button.height - inventory[0].height) < 1
    )
  ).toBe(true);
  await info.attach('body-popup-main', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await info.attach('body-main-order-layout', {
    body: JSON.stringify(inventory),
    contentType: 'application/json',
  });
  await group.getByRole('button', { name: 'Body', exact: true }).click();
  expect(await page.getByRole('menuitemradio').allTextContents()).toEqual([
    'Body',
    'Heading 1',
    'Heading 2',
    'Heading 3',
    'Bullet List',
    'Numbered List',
    'Checklist',
    'Code',
    'Quote',
  ]);
  await page.keyboard.press('Escape');
  for (const format of formats) {
    if (format.label === 'Underline') {
      await group.getByRole('button').nth(2).click();
      const menu = page.getByRole('menu');
      await info.attach('body-popup-six-More', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      expect(
        await menu
          .getByRole('button')
          .evaluateAll((buttons) =>
            buttons.map(
              (button) =>
                button.getAttribute('aria-label') || button.textContent?.trim()
            )
          )
      ).toEqual(formats.slice(2).map((item) => item.label));
    }
    const before = await page.locator('#live-state').textContent();
    const button = page.getByRole('button', {
      name: format.label,
      exact: true,
    });
    await button.click();
    await expect(body.locator(format.selector)).toHaveText(
      'Select this phrase'
    );
    await expect(page.locator('#live-state')).not.toHaveText(before ?? '');
    await button.click();
    await expect(body.locator(format.selector)).toHaveCount(0);
    await expect(body).toHaveText('Select this phrase');
    await expect
      .poll(() => page.evaluate(() => document.getSelection()?.toString()))
      .toBe('Select this phrase');
  }
  expect(wasm).toEqual([
    '1424d8634496b8309b763eeacb3283c9c772b6cfeb65be9d3e8ca6cf11ab8def',
  ]);
  expect(errors).toEqual([]);
  await info.attach('actual-native-wasm', {
    body: JSON.stringify(wasm),
    contentType: 'application/json',
  });
});

for (const lock of [
  'Lock generation',
  'Lock waiting',
  'Lock error',
  'Read only',
]) {
  test(`already-open body popup respects ${lock}`, async ({ page }) => {
    await page.goto('/?body');
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
    await page.locator('#body').focus();
    await page.locator('#body').evaluate((root) => {
      const text = document
        .createTreeWalker(root, NodeFilter.SHOW_TEXT)
        .nextNode();
      if (!text) throw new Error('Missing native text');
      root.ownerDocument.getSelection()?.setBaseAndExtent(text, 0, text, 18);
    });
    const toolbar = page.getByRole('toolbar', { name: 'Document selection' });
    await expect(toolbar).toBeVisible();
    await page.getByRole('button', { name: lock, exact: true }).click();
    await expect(toolbar).toHaveCount(0);
    await expect(page.locator('#body')).toHaveText('Select this phrase');
  });
}

// Source MarkdownPopupToolbar (MarkdownPopup.tsx:621-760): AI edit first,
// one divider, then FormatTools; the AI prompt replaces the whole toolbar at
// its measured width; Escape returns to the toolbar.
test('body popup AI edit slot comes first and swaps to its prompt at the toolbar width', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?body&ai');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  const body = page.locator('#body');
  await body.focus();
  await body.evaluate((root) => {
    const text = document
      .createTreeWalker(root, NodeFilter.SHOW_TEXT)
      .nextNode();
    if (!text) throw new Error('Missing actual native text');
    root.ownerDocument.getSelection()?.setBaseAndExtent(text, 0, text, 18);
  });
  const toolbar = page.getByRole('toolbar', { name: 'Document selection' });
  await expect(toolbar).toBeVisible();
  await info.attach('body-popup-ai-toolbar', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  const order = await toolbar
    .locator('button, [role=separator]')
    .evaluateAll((nodes) =>
      nodes.map((node) =>
        node.getAttribute('role') === 'separator'
          ? '|'
          : node.getAttribute('aria-label') || node.textContent?.trim()
      )
    );
  await info.attach('body-popup-ai-order', {
    body: JSON.stringify(order),
    contentType: 'application/json',
  });
  expect(order).toEqual(['AI edit', '|', 'Bold', 'Italic', '', '|', 'Body']);
  const width = (await toolbar.boundingBox())?.width;
  await toolbar.getByRole('button', { name: 'AI edit', exact: true }).click();
  const prompt = page.getByRole('textbox', { name: 'Describe changes' });
  await expect(prompt).toBeFocused();
  await expect(prompt).toHaveAttribute('data-captured', 'Select this phrase');
  await expect(toolbar.getByRole('button')).toHaveCount(0);
  expect((await toolbar.boundingBox())?.width).toBe(width);
  await info.attach('body-popup-ai-prompt', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.keyboard.press('Escape');
  await expect(prompt).toHaveCount(0);
  await expect(
    toolbar.getByRole('button', { name: 'AI edit', exact: true })
  ).toBeVisible();
  expect(errors).toEqual([]);
});
