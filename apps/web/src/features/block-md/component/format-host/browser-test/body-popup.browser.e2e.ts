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
  const toolbar = page.getByRole('toolbar');
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
      await group.getByRole('button').nth(3).click();
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
    const toolbar = page.getByRole('toolbar');
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
  const toolbar = page.getByRole('toolbar');
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

// Source MarkdownPopup on a touch device (PopupToolbar touch branch):
// TouchSelectionToolbar in a GeneralizedPopup, whose "Edit with AI" opens the
// AI MobileDrawer and hides the popup. Expected order: the Source control
// (touch-toolbar-order.source-controls.test.tsx) for the fixture's
// capabilities: canEdit, no comment capability, no user, no list, not iOS,
// the AI flag on, a snippet-link host.
const SOURCE_TOUCH_ORDER = ['Copy', 'Cut', 'Share', 'Edit with AI'];

for (const device of [
  { name: 'phone', viewport: { width: 390, height: 844 }, scale: 3 },
  { name: 'tablet', viewport: { width: 820, height: 1180 }, scale: 2 },
]) {
  test.describe(`touch ${device.name}`, () => {
    test.use({
      viewport: device.viewport,
      deviceScaleFactor: device.scale,
      isMobile: true,
      hasTouch: true,
    });

    test(`body popup on a touch ${device.name} shows the Source touch toolbar and opens the AI drawer`, async ({
      page,
    }, info) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('/?body&ai');
      await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
      // isTouchDevice() reads (pointer: coarse); without it this is not a
      // touch run at all.
      if (!(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)))
        throw new Error('SETUP: (pointer: coarse) is not emulated');
      const body = page.locator('#body');
      await body.tap();
      await body.evaluate((root) => {
        const text = document
          .createTreeWalker(root, NodeFilter.SHOW_TEXT)
          .nextNode();
        if (!text) throw new Error('SETUP: missing actual native text');
        root.ownerDocument.getSelection()?.setBaseAndExtent(text, 0, text, 18);
      });
      // The native fixture is mounted and its MODEL selection, published at
      // the current generation, is a non-collapsed range over the exact text;
      // otherwise a broken selection setup would pass as the missing toolbar.
      await expect
        .poll(
          async () => {
            const facts = JSON.parse(
              (await page.locator('#selection-facts').textContent()) || '{}'
            );
            const model = facts.model;
            return {
              mounted: typeof facts.generation === 'number',
              range: model?.kind === 'range',
              collapsed:
                model?.kind === 'range' &&
                JSON.stringify(model.anchor) === JSON.stringify(model.focus),
              selectedText: facts.selectedText,
            };
          },
          { message: 'SETUP: native model selection not admitted' }
        )
        .toEqual({
          mounted: true,
          range: true,
          collapsed: false,
          selectedText: 'Select this phrase',
        });
      expect(errors, 'SETUP: page errors before the toolbar wait').toEqual([]);
      // The visible toolbar shows after the popup's 100 ms visibility lag.
      const firstOption = page
        .getByRole('button', { name: SOURCE_TOUCH_ORDER[0], exact: true })
        .filter({ visible: true });
      // A page error during the wait makes this a SETUP failure, never the
      // missing-toolbar RED: it replaces the expected assertion's error,
      // which is otherwise rethrown unchanged.
      let waitError: unknown;
      try {
        await expect(firstOption, 'TOUCH TOOLBAR NOT SHOWN').toBeVisible();
      } catch (error) {
        waitError = error;
      }
      await info.attach(`touch-${device.name}-page-errors`, {
        body: JSON.stringify(errors),
        contentType: 'application/json',
      });
      if (errors.length > 0)
        throw new Error(
          `SETUP: page errors during the toolbar wait: ${JSON.stringify(errors)}`
        );
      if (waitError !== undefined) throw waitError;
      await info.attach(`touch-${device.name}-toolbar`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      // Read every page of the actual toolbar, following the chevrons. The
      // root is TouchSelectionToolbar's own container, anchored independently
      // of whichever option is on screen; off-page options are inert and the
      // measuring row is aria-hidden.
      const toolbar = page.locator('div.relative.touch-pan-y');
      await expect(toolbar).toHaveCount(1);
      const pageOptions = () =>
        toolbar.evaluate((root) =>
          [...root.querySelectorAll('button')]
            .filter(
              (button) =>
                !button.closest('[inert], [aria-hidden="true"]') &&
                button.getBoundingClientRect().width > 0 &&
                !['Previous options', 'More options'].includes(
                  button.getAttribute('aria-label') ?? ''
                )
            )
            .map((button) => button.textContent?.trim() ?? '')
        );
      const order: string[] = [];
      const more = toolbar.getByRole('button', { name: 'More options' });
      const previous = toolbar.getByRole('button', {
        name: 'Previous options',
      });
      const MAX_PAGES = 10;
      for (let index = 0; ; index++) {
        if (index >= MAX_PAGES)
          throw new Error('Touch toolbar pages did not end');
        // Pages are disjoint; every occurrence is kept, in page order.
        order.push(...(await pageOptions()));
        if (!(await more.isVisible())) break;
        await more.tap();
      }
      await info.attach(`touch-${device.name}-order`, {
        body: JSON.stringify(order),
        contentType: 'application/json',
      });
      expect(order).toEqual(SOURCE_TOUCH_ORDER);
      // Named gap C-TOUCH-TASK-LABEL-01 (owner t1zz, Task packet 3): the Task
      // option is omitted until Source's exact label lands, never guessed.
      expect(
        order.filter((option) =>
          /^(Task|\d+ tasks|Converting\.\.\.)$/.test(option)
        ),
        'C-TOUCH-TASK-LABEL-01: Task option absent'
      ).toEqual([]);
      // Back to the first page, then page forward to Edit with AI.
      for (let index = 0; await previous.isVisible(); index++) {
        if (index >= MAX_PAGES)
          throw new Error('Touch toolbar did not page back');
        await previous.tap();
      }
      const editWithAi = toolbar
        .getByRole('button', { name: 'Edit with AI', exact: true })
        .filter({ visible: true });
      for (let index = 0; !(await editWithAi.isVisible()); index++) {
        if (index >= MAX_PAGES) throw new Error('Edit with AI not reached');
        await more.tap();
      }
      await editWithAi.tap();
      const drawer = page.getByRole('dialog', { name: 'Edit with AI' });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByPlaceholder('Describe changes')).toBeVisible();
      // Source hides the popup when the drawer opens.
      await expect(firstOption).toHaveCount(0);
      await info.attach(`touch-${device.name}-ai-drawer`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      expect(errors).toEqual([]);
    });

    // Source TouchSelectionToolbar's Copy and Cut run execCommand on the
    // editor; they must reach the native body's own clipboard handlers with
    // the keyboard shortcuts' payload, model and single history step.
    test(`Copy and Cut on a touch ${device.name} equal the keyboard shortcuts`, async ({
      page,
    }, info) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page
        .context()
        .grantPermissions(['clipboard-read', 'clipboard-write']);
      const open = async () => {
        await page.goto('/?body&ai');
        await expect(page.locator('html')).toHaveAttribute(
          'data-ready',
          'true'
        );
        if (
          !(await page.evaluate(() => matchMedia('(pointer: coarse)').matches))
        )
          throw new Error('SETUP: (pointer: coarse) is not emulated');
      };
      const body = page.locator('#body');
      const selectPhrase = async () => {
        await body.tap();
        await body.evaluate((root) => {
          const text = document
            .createTreeWalker(root, NodeFilter.SHOW_TEXT)
            .nextNode();
          if (!text) throw new Error('SETUP: missing actual native text');
          root.ownerDocument.getSelection()?.setBaseAndExtent(text, 0, text, 7);
        });
        await expect
          .poll(
            async () =>
              JSON.parse(
                (await page.locator('#selection-facts').textContent()) || '{}'
              ).selectedText,
            { message: 'SETUP: native model selection not admitted' }
          )
          .toBe('Select ');
      };
      const clipboard = () =>
        page.evaluate(async () => {
          const items = await navigator.clipboard.read();
          const payload: Record<string, string> = {};
          for (const item of items)
            for (const type of item.types)
              payload[type] = await (await item.getType(type)).text();
          return payload;
        });
      const resetClipboard = () =>
        page.evaluate(() => navigator.clipboard.writeText('sentinel'));
      const live = async () =>
        (await page.locator('#live-state').textContent()) ?? '';
      const touchOption = (name: string) =>
        page
          .getByRole('button', { name, exact: true })
          .filter({ visible: true });

      // Copy: the keyboard payload, then the touch Copy payload.
      await open();
      await selectPhrase();
      await resetClipboard();
      await page.keyboard.press('Control+c');
      const keyboardCopy = await clipboard();
      expect(keyboardCopy['text/plain']).toBe('Select ');
      await resetClipboard();
      await selectPhrase();
      await expect(touchOption('Copy')).toBeVisible();
      await touchOption('Copy').tap();
      const touchCopy = await clipboard();
      await info.attach(`touch-${device.name}-copy-payloads`, {
        body: JSON.stringify({ keyboardCopy, touchCopy }),
        contentType: 'application/json',
      });
      expect(touchCopy).toEqual(keyboardCopy);

      // Cut: the keyboard result and its one undo step, then the touch Cut.
      // The seed is not undoable (the fixture's open clears history), so each
      // Cut is its own undo step by construction. The baseline is the
      // canonical live state published with the selection, not the seed.
      await open();
      await selectPhrase();
      const beforeCut = await live();
      await page.keyboard.press('Control+x');
      await expect.poll(live).not.toBe(beforeCut);
      const keyboardCut = await live();
      const keyboardCutClipboard = await clipboard();
      await page.keyboard.press('Control+z');
      await expect.poll(live).toBe(beforeCut);
      // The touch Cut on the same page and document (node ids are minted per
      // load), from the same baseline.
      await selectPhrase();
      await resetClipboard();
      await expect(touchOption('Cut')).toBeVisible();
      await touchOption('Cut').tap();
      await expect.poll(live).not.toBe(beforeCut);
      expect(await live()).toBe(keyboardCut);
      expect(await clipboard()).toEqual(keyboardCutClipboard);
      // One history step: a single undo restores the pre-cut baseline.
      await body.focus();
      await page.keyboard.press('Control+z');
      await expect.poll(live).toBe(beforeCut);
      expect(errors).toEqual([]);
    });
  });
}
