import { expect, type Locator, type Page, test } from '@playwright/test';
import { installBrowserHooks } from './browser-hooks';

async function toggleChecklistMarker(
  page: Page,
  check: Locator,
  hasTouch: boolean
) {
  await check.scrollIntoViewIfNeeded();
  const point = await check.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const marker = getComputedStyle(element, '::before');
    return {
      clientX:
        bounds.left + parseFloat(marker.left) + parseFloat(marker.width) / 2,
      clientY:
        bounds.top + parseFloat(marker.top) + parseFloat(marker.height) / 2,
    };
  });
  expect(
    await check.evaluate(
      (element, point) =>
        document.elementFromPoint(point.clientX, point.clientY) === element,
      point
    )
  ).toBe(true);
  // Native input uses the visual viewport; DOM rects use the layout viewport.
  const viewport = await page.evaluate(() => ({
    left: visualViewport?.offsetLeft ?? 0,
    top: visualViewport?.offsetTop ?? 0,
  }));
  const x = point.clientX - viewport.left;
  const y = point.clientY - viewport.top;
  if (hasTouch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

installBrowserHooks();

test('single-line title drops multiline paste while retaining the first line', async ({
  page,
}) => {
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await title.click();
  await title.evaluate((element) => {
    const data = new DataTransfer();
    data.setData('text/plain', 'first\nsecond');
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      })
    );
  });
  await expect(title).toHaveText('first');
  await expect(title.locator(':scope > p')).toHaveCount(1);
});

test('clipboard precedence selects HTML instead of interpreting plain Markdown', async ({
  page,
}) => {
  const body = page.getByRole('textbox', { name: 'Body', exact: true });
  await body.click();
  await body.evaluate((element) => {
    const data = new DataTransfer();
    data.setData('text/plain', '**wrong**');
    data.setData('text/html', '<p><em>right</em></p>');
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      })
    );
  });
  await expect(body).toHaveText('right');
  await expect(body.locator('em')).toHaveText('right');
  await expect(body.locator('strong')).toHaveCount(0);
});

test('Shift paste preserves literal Markdown', async ({ page }) => {
  const body = page.getByRole('textbox', { name: 'Body', exact: true });
  await body.click();
  await page.keyboard.down('Shift');
  await body.evaluate((element) => {
    const data = new DataTransfer();
    data.setData('text/plain', '**literal**');
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      })
    );
  });
  await page.keyboard.up('Shift');
  await expect(body).toHaveText('**literal**');
  await expect(body.locator('strong')).toHaveCount(0);
});

test('inline code escape leaves subsequent text unformatted after save and reopen', async ({
  page,
}) => {
  const body = page.getByRole('textbox', { name: 'Body', exact: true });
  await body.click();
  await page.keyboard.type('`code`');
  await expect(body.locator('code')).toHaveText('code');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('tail');
  await expect(body.locator('code')).toHaveText('code');
  await expect(body).toHaveText('code tail');
  await page.getByRole('button', { name: 'Save state', exact: true }).click();
  await body.fill('replace');
  await page
    .getByRole('button', { name: 'Reopen saved state', exact: true })
    .click();
  await expect(body).toHaveText('code tail');
  await expect(body.locator('code')).toHaveText('code');
});

test('read-only blocks typing and leaves accessible content available', async ({
  page,
}) => {
  const body = page.getByRole('textbox', { name: 'Body', exact: true });
  await body.fill('preserve');
  await page.getByRole('button', { name: 'Read only', exact: true }).click();
  await expect(body).toHaveAttribute('contenteditable', 'false');
  await expect(body).toHaveAttribute('aria-readonly', 'true');
  await body.click();
  await page.keyboard.type('forbidden');
  await expect(body).toHaveText('preserve');
  await page.getByRole('button', { name: 'Editable', exact: true }).click();
  await expect(body).toHaveAttribute('contenteditable', 'true');
  await body.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' allowed');
  await expect(body).toHaveText('preserve allowed');
});

test('typing is undoable and redo restores its formatting', async ({
  page,
}) => {
  const body = page.getByRole('textbox', { name: 'Body', exact: true });
  await body.click();
  await page.keyboard.type('**bold**');
  await expect(body.locator('strong')).toHaveText('bold');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(body.locator('strong')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(body.locator('strong')).toHaveText('bold');
});

test('slash menu filters and Enter inserts the selected heading', async ({
  page,
}) => {
  const body = page.getByRole('textbox', { name: 'Body', exact: true });
  await body.click();
  await page.keyboard.type('/heading 2');
  const menu = page.locator('.menu-surface');
  await expect(menu.getByText('Heading 2', { exact: true })).toBeVisible();
  await expect(menu.getByText('Heading 1', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await page.keyboard.type('Heading content');
  await expect(body.locator('h2')).toHaveText('Heading content');
  await expect(body).toHaveText('Heading content');
});

test('slash menu Tab and ShiftTab navigate and ArrowUp wraps through Table and Link to checklist', async ({
  page,
}) => {
  const body = page.getByRole('textbox', { name: 'Body', exact: true });
  await body.click();
  await page.keyboard.type('/');
  const menu = page.locator('.menu-surface');
  await expect(menu.getByText('Normal Text', { exact: true })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(body).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  const selected = menu.locator('[class~="bg-ink/5"]');
  await expect(selected).toContainText('Normal Text');
  await page.keyboard.press('ArrowUp');
  await expect(selected).toContainText('Table');
  await page.keyboard.press('ArrowUp');
  await expect(selected).toContainText('Link');
  await page.keyboard.press('ArrowUp');
  await expect(selected).toContainText('Checklist');
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await page.keyboard.type('Checklist content');
  await expect(body.getByRole('checkbox')).toHaveText('Checklist content');
  await expect(body.getByRole('checkbox')).not.toBeChecked();
});

test('slash menu Escape retains the literal trigger and closes', async ({
  page,
}) => {
  const body = page.getByRole('textbox', { name: 'Body', exact: true });
  await body.click();
  await page.keyboard.type('/');
  await expect(page.locator('.menu-surface')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu-surface')).toHaveCount(0);
  await expect(body).toHaveText('/');
  await page.keyboard.type('ordinary');
  await expect(body).toHaveText('/ordinary');
});

test('checklist pointer or touch toggles survive serialization and reopen', async ({
  page,
  hasTouch,
}) => {
  const body = page.getByRole('textbox', { name: 'Body', exact: true });
  await body.click();
  await page.keyboard.type('/checklist');
  await expect(
    page.locator('.menu-surface').getByText('Checklist', { exact: true })
  ).toBeVisible();
  await expect(
    page.locator('.menu-surface').getByText('Normal Text', { exact: true })
  ).toHaveCount(0);
  await page.keyboard.press('Enter');
  await page.keyboard.type('Retained check');
  const check = body.getByRole('checkbox');
  await expect(check).not.toBeChecked();
  expect(
    await check.evaluate((element) => (element as HTMLElement).tabIndex)
  ).toBe(-1);
  await toggleChecklistMarker(page, check, hasTouch);
  await expect(check).toBeChecked();
  await page.getByRole('button', { name: 'Save state', exact: true }).click();
  await body.fill('temporary');
  await page
    .getByRole('button', { name: 'Reopen saved state', exact: true })
    .click();
  await expect(check).toHaveText('Retained check');
  await expect(check).toBeChecked();
});

test('read-only checklist rejects pointer toggles and resumes when editable', async ({
  page,
  hasTouch,
}) => {
  const body = page.getByRole('textbox', { name: 'Body', exact: true });
  await body.click();
  await page.keyboard.type('/checklist');
  await expect(
    page.locator('.menu-surface').getByText('Checklist', { exact: true })
  ).toBeVisible();
  await expect(
    page.locator('.menu-surface').getByText('Normal Text', { exact: true })
  ).toHaveCount(0);
  await page.keyboard.press('Enter');
  await page.keyboard.type('Protected check');
  const check = body.getByRole('checkbox');
  await page.getByRole('button', { name: 'Read only', exact: true }).click();
  await toggleChecklistMarker(page, check, hasTouch);
  await expect(check).not.toBeChecked();
  await expect(check).toHaveText('Protected check');
  await page.getByRole('button', { name: 'Editable', exact: true }).click();
  await toggleChecklistMarker(page, check, hasTouch);
  await expect(check).toBeChecked();
});

test('slash stays literal inside a word', async ({ page }) => {
  const body = page.getByRole('textbox', { name: 'Body', exact: true });
  await body.click();
  await page.keyboard.type('path/child');
  await expect(body).toHaveText('path/child');
  await expect(page.locator('.menu-surface')).toHaveCount(0);
});

test('slash menu pointer or touch selection preserves editor focus', async ({
  page,
}, info) => {
  const body = page.getByRole('textbox', { name: 'Body', exact: true });
  await body.click();
  await page.keyboard.type('/');
  const item = page
    .locator('.menu-surface')
    .getByText('Heading 3', { exact: true });
  if (info.project.name === 'desktop') await item.click();
  else await item.tap();
  await expect(body).toBeFocused();
  await expect(page.locator('.menu-surface')).toHaveCount(0);
  await page.keyboard.type('Pointer heading');
  await expect(body.locator('h3')).toHaveText('Pointer heading');
});

test('empty slash results dismiss safely with navigation and Enter', async ({
  page,
}) => {
  const body = page.getByRole('textbox', { name: 'Body', exact: true });
  await body.click();
  await page.keyboard.type('/zzzznomatch');
  await expect(page.locator('.menu-surface')).toHaveText('No results');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page.locator('.menu-surface')).toHaveCount(0);
  await expect(body).toHaveText('');
});

for (const mime of [
  'text/plain',
  'application/pdf',
  'image/png',
  'image/gif',
]) {
  test(`file paste routes ${mime} to attachments before plain Markdown`, async ({
    page,
  }) => {
    const body = page.getByRole('textbox', { name: 'Body', exact: true });
    await body.click();
    await body.evaluate((element, mime) => {
      const data = new DataTransfer();
      data.items.add(
        new File(['fixture'], 'attachment.fixture', { type: mime })
      );
      data.setData('text/plain', '**not body text**');
      element.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        })
      );
    }, mime);
    await expect(page.locator('#pasted-files')).toHaveText(
      JSON.stringify({ files: ['attachment.fixture'], directories: [] })
    );
    await expect(body).toHaveText('');
  });
}

for (const list of [false, true]) {
  test(`file drop places the caret at the chosen block with list=${list}`, async ({
    page,
  }) => {
    const body = page.getByRole('textbox', { name: 'Body', exact: true });
    await body.click();
    await page.keyboard.type(list ? '- First' : 'First');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second');
    const blocks = body.locator(list ? 'li' : ':scope > p');
    await expect(blocks).toHaveCount(2);
    await body.evaluate((root, list) => {
      const first = root.querySelector(list ? 'li' : ':scope > p');
      if (!first) throw new Error('Missing drop target');
      const rect = first.getBoundingClientRect();
      const data = new DataTransfer();
      data.items.add(
        new File(['fixture'], 'dropped.txt', { type: 'text/plain' })
      );
      const init = {
        dataTransfer: data,
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.bottom - 1,
      };
      root.dispatchEvent(new DragEvent('dragover', init));
      root.dispatchEvent(new DragEvent('drop', init));
    }, list);
    await expect(page.locator('#dropped-files')).toHaveText(
      JSON.stringify({ position: 'after', files: ['dropped.txt'] })
    );
    await page.keyboard.type(' appended');
    await expect(blocks.nth(0)).toHaveText('First appended');
    await expect(blocks.nth(1)).toHaveText('Second');
  });
}

async function openRocketMenu(page: Page) {
  const body = page.getByRole('textbox', { name: 'Body', exact: true });
  await body.click();
  await page.keyboard.type(':rocket');
  const menu = page.locator('.menu-surface');
  await expect(menu.getByText('rocket', { exact: true })).toBeVisible();
  return { body, menu };
}

test('emoji menu filtering and wrapped keyboard selection preserve the typing caret', async ({
  page,
}) => {
  const { body, menu } = await openRocketMenu(page);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowDown');
  await expect(body).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(body).toHaveText('🚀');
  await page.keyboard.type(' tail');
  await expect(body).toHaveText('🚀 tail');
});

test('emoji enclosed shortcode resolves with the loaded production catalog', async ({
  page,
}) => {
  const { body, menu } = await openRocketMenu(page);
  await page.keyboard.type(':');
  await expect(body).toHaveText('🚀');
  await expect(menu).toHaveCount(0);
});

test('emoji Escape preserves the literal search and subsequent text', async ({
  page,
}) => {
  const { body, menu } = await openRocketMenu(page);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(body).toHaveText(':rocket');
  await page.keyboard.type(' ordinary');
  await expect(body).toHaveText(':rocket ordinary');
});

test('emoji trigger stays literal inside a word', async ({ page }) => {
  const body = page.getByRole('textbox', { name: 'Body', exact: true });
  await body.click();
  await page.keyboard.type('word:rocket');
  await expect(body).toHaveText('word:rocket');
  await expect(page.locator('.menu-surface')).toHaveCount(0);
});

test('emoji pointer or touch selection inserts at the original editor caret', async ({
  page,
  hasTouch,
}) => {
  const { body, menu } = await openRocketMenu(page);
  const item = menu.getByText('rocket', { exact: true });
  if (hasTouch) await item.tap();
  else await item.click();
  await expect(menu).toHaveCount(0);
  await expect(body).toHaveText('🚀');
  await expect(body).toBeFocused();
  await page.keyboard.type(' tail');
  await expect(body).toHaveText('🚀 tail');
});

test('emoji empty results dismiss safely on navigation and Enter', async ({
  page,
}) => {
  const body = page.getByRole('textbox', { name: 'Body', exact: true });
  await body.click();
  await page.keyboard.type(':zzzznomatchemoji999');
  const menu = page.locator('.menu-surface');
  await expect(menu.getByText('No results', { exact: true })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(body).toHaveText(':zzzznomatchemoji999');
  await expect(body.locator(':scope > p')).toHaveCount(1);
});

test('emoji first Space dismisses the bare trigger without inserting a space', async ({
  page,
}) => {
  const body = page.getByRole('textbox', { name: 'Body', exact: true });
  await body.click();
  await page.keyboard.type(':');
  await expect(page.locator('.menu-surface')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.locator('.menu-surface')).toHaveCount(0);
  await expect(body).toHaveText(':');
});

async function liveImageScale(page: Page) {
  const state = JSON.parse(
    (await page.locator('#live-state').textContent()) ?? '{}'
  );
  return state.root?.children?.find(
    (node: { type: string }) => node.type === 'image'
  )?.scale;
}
async function loadImageDecorator(page: Page) {
  await page.getByRole('button', { name: 'Load image', exact: true }).click();
  const body = page.getByRole('textbox', { name: 'Body', exact: true });
  const image = body.locator('img');
  await expect(image).toHaveCount(1);
  await expect
    .poll(() =>
      image.evaluate(
        (element: HTMLImageElement) =>
          element.complete && element.naturalWidth === 200
      )
    )
    .toBe(true);
  await expect(body.locator('.cursor-col-resize')).toHaveCount(2);
  await expect.poll(() => liveImageScale(page)).toBe(1);
  return { body, image };
}
async function dragImageHandle(
  page: Page,
  handle: Locator,
  delta: number,
  hasTouch: boolean
) {
  await handle.scrollIntoViewIfNeeded();
  const point = await handle.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 - (visualViewport?.offsetLeft ?? 0),
      y: rect.top + rect.height / 2 - (visualViewport?.offsetTop ?? 0),
    };
  });
  if (hasTouch) {
    const session = await page.context().newCDPSession(page);
    try {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: point.x, y: point.y, id: 1 }],
      });
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: point.x + delta, y: point.y, id: 1 }],
      });
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
    } finally {
      await session.detach();
    }
  } else {
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + delta, point.y);
    await page.mouse.up();
  }
}
for (const side of ['left', 'right'] as const) {
  test(`image decorator ${side} pointer resize persists through save and reopen`, async ({
    page,
    hasTouch,
  }) => {
    const { body, image } = await loadImageDecorator(page);
    const handles = body.locator('.cursor-col-resize');
    await dragImageHandle(
      page,
      side === 'left' ? handles.first() : handles.last(),
      40,
      hasTouch
    );
    const scale = side === 'left' ? 0.6 : 1.4;
    await expect.poll(() => liveImageScale(page)).toBeCloseTo(scale, 5);
    await page.getByRole('button', { name: 'Save state', exact: true }).click();
    // Replace the resized node with a fresh scale-1 fixture before reopening.
    // Selection/deletion and undo are exercised separately below.
    await loadImageDecorator(page);
    await expect.poll(() => liveImageScale(page)).toBe(1);
    await page
      .getByRole('button', { name: 'Reopen saved state', exact: true })
      .click();
    await expect(image).toHaveCount(1);
    await expect
      .poll(() =>
        image.evaluate(
          (element: HTMLImageElement) =>
            element.complete && element.naturalWidth === 200
        )
      )
      .toBe(true);
    await expect.poll(() => liveImageScale(page)).toBeCloseTo(scale, 5);
  });
}
test('image decorator resize clamps at its minimum height', async ({
  page,
  hasTouch,
}) => {
  const { body } = await loadImageDecorator(page);
  await dragImageHandle(
    page,
    body.locator('.cursor-col-resize').last(),
    -100,
    hasTouch
  );
  await expect.poll(() => liveImageScale(page)).toBe(0.5);
});
test('image decorator read-only removes resize controls and preserves saved data', async ({
  page,
  hasTouch,
}) => {
  const { body, image } = await loadImageDecorator(page);
  const before = await page.locator('#live-state').textContent();
  await page.getByRole('button', { name: 'Read only', exact: true }).click();
  await expect(body.locator('.cursor-col-resize')).toHaveCount(0);
  if (hasTouch) await image.tap();
  else await image.click();
  expect(await page.locator('#live-state').textContent()).toBe(before);
  await page.getByRole('button', { name: 'Editable', exact: true }).click();
  await expect(body.locator('.cursor-col-resize')).toHaveCount(2);
  await expect.poll(() => liveImageScale(page)).toBe(1);
});
test('image decorator selection deletes only the image and undo restores its renderer', async ({
  page,
  hasTouch,
}) => {
  const { body, image } = await loadImageDecorator(page);
  if (hasTouch) await image.tap();
  else await image.click();
  await page.keyboard.press('Backspace');
  await expect(image).toHaveCount(0);
  await expect(body).toHaveText('after');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(image).toHaveCount(1);
  await expect
    .poll(() =>
      image.evaluate(
        (element: HTMLImageElement) =>
          element.complete && element.naturalWidth === 200
      )
    )
    .toBe(true);
});
test('image decorator controls open and close the real full-screen viewer', async ({
  page,
  hasTouch,
}) => {
  const { body, image } = await loadImageDecorator(page);
  if (hasTouch) await image.tap();
  else await image.click();
  // The first MediaButtons action opens the viewer. Its icon-only control
  // currently has no accessible name; this does not establish toolbar AX.
  const viewAction = body.locator('button').first();
  await expect(viewAction).toBeVisible();
  if (hasTouch) await viewAction.tap();
  else await viewAction.click();
  const dialog = page.getByRole('dialog', { name: 'Lightbox image viewer' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(image).toHaveCount(1);
});

async function liveCodeLanguage(page: Page) {
  const state = JSON.parse(
    (await page.locator('#live-state').textContent()) ?? '{}'
  );
  return state.root?.children?.find(
    (node: { type: string }) => node.type === 'custom-code'
  )?.language;
}
async function loadCodeAccessory(page: Page) {
  await page.getByRole('button', { name: 'Load code', exact: true }).click();
  const body = page.getByRole('textbox', { name: 'Body', exact: true });
  const header = page.locator('.md-code-box-header');
  await expect(body.locator('code')).toHaveText('const value = 7;');
  await expect(header).toHaveCount(1);
  await expect.poll(() => liveCodeLanguage(page)).toBe('javascript');
  return { body, header };
}
test('code accessory pointer language choice survives saved-state restoration', async ({
  page,
  hasTouch,
}) => {
  const { body, header } = await loadCodeAccessory(page);
  const trigger = header.getByRole('button', {
    name: 'JavaScript',
    exact: true,
  });
  if (hasTouch) await trigger.tap();
  else await trigger.click();
  const python = page.getByRole('menuitem', { name: 'Python', exact: true });
  if (hasTouch) await python.tap();
  else await python.click();
  await expect.poll(() => liveCodeLanguage(page)).toBe('python');
  await expect(
    header.getByRole('button', { name: 'Python', exact: true })
  ).toBeVisible();
  await expect(body.locator('code')).toHaveText('const value = 7;');
  await page.getByRole('button', { name: 'Save state', exact: true }).click();
  await loadCodeAccessory(page);
  await page
    .getByRole('button', { name: 'Reopen saved state', exact: true })
    .click();
  await expect.poll(() => liveCodeLanguage(page)).toBe('python');
  await expect(
    header.getByRole('button', { name: 'Python', exact: true })
  ).toBeVisible();
});
test('code accessory language menu supports Home arrows Enter and Escape', async ({
  page,
  hasTouch,
}) => {
  const { header } = await loadCodeAccessory(page);
  const trigger = header.getByRole('button', {
    name: 'JavaScript',
    exact: true,
  });
  if (hasTouch) await trigger.tap();
  else await trigger.click();
  await page.keyboard.press('Home');
  await expect(
    page.getByRole('menuitem', { name: 'Plain Text', exact: true })
  ).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(
    page.getByRole('menuitem', { name: 'TypeScript', exact: true })
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => liveCodeLanguage(page)).toBe('typescript');
  const updated = header.getByRole('button', {
    name: 'TypeScript',
    exact: true,
  });
  if (hasTouch) await updated.tap();
  else await updated.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect.poll(() => liveCodeLanguage(page)).toBe('typescript');
});
test('code accessory copies the actual code to the browser clipboard', async ({
  page,
  context,
  hasTouch,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => navigator.clipboard.writeText('before code copy'));
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'before code copy'
  );
  const { header } = await loadCodeAccessory(page);
  // Production icon-only Copy/Delete actions currently lack accessible names.
  // Their order is used here; this is not toolbar accessibility acceptance.
  const copy = header.locator('button').last();
  if (hasTouch) await copy.tap();
  else await copy.click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('const value = 7;');
});
test('code accessory deletion preserves following text and undo restores the block', async ({
  page,
  hasTouch,
}) => {
  const { body, header } = await loadCodeAccessory(page);
  await expect(header.locator('button')).toHaveCount(3);
  const remove = header.locator('button').nth(1);
  if (hasTouch) await remove.tap();
  else await remove.click();
  await expect(body.locator('code')).toHaveCount(0);
  await expect(header).toHaveCount(0);
  await expect(body).toHaveText('after');
  await expect(body).toBeFocused();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(body.locator('code')).toHaveText('const value = 7;');
  await expect(
    header.getByRole('button', { name: 'JavaScript', exact: true })
  ).toBeVisible();
});
test('code accessory mounted read-only shows a static language and copy only', async ({
  page,
  context,
  hasTouch,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => navigator.clipboard.writeText('before code copy'));
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'before code copy'
  );
  await page.getByRole('button', { name: 'Read only', exact: true }).click();
  const { body, header } = await loadCodeAccessory(page);
  await expect(header).toContainText('JavaScript');
  await expect(
    header.getByRole('button', { name: 'JavaScript', exact: true })
  ).toHaveCount(0);
  await expect(header.locator('button')).toHaveCount(1);
  const before = await page.locator('#live-state').textContent();
  if (hasTouch) await header.locator('button').tap();
  else await header.locator('button').click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('const value = 7;');
  expect(await page.locator('#live-state').textContent()).toBe(before);
  await expect(body).toHaveAttribute('aria-readonly', 'true');
});

async function openTablePicker(page: Page) {
  const body = page.getByRole('textbox', { name: 'Body', exact: true });
  await body.click();
  await page.keyboard.type('/table');
  const slash = page.locator('.menu-surface');
  await expect(slash.getByText('Table', { exact: true })).toBeVisible();
  await expect(slash.getByText('Normal Text', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Enter');
  const picker = page.locator('.menu-surface');
  await expect(picker.locator('p')).toHaveText('3 × 3');
  await expect(body.locator('table')).toHaveCount(0);
  await expect(body).toBeFocused();
  return { body, picker };
}
test('table picker defers confirmation and restores a filled default table from saved state', async ({
  page,
}) => {
  const { body, picker } = await openTablePicker(page);
  await page.keyboard.press('Enter');
  await expect(picker).toHaveCount(0);
  await expect(body.locator('table')).toHaveCount(1);
  await expect(body.locator('td')).toHaveCount(9);
  await expect(body.locator('th')).toHaveCount(0);
  await page.keyboard.type('cell');
  await expect(body.locator('td').first()).toHaveText('cell');
  await page.getByRole('button', { name: 'Save state', exact: true }).click();
  await loadImageDecorator(page);
  await expect(body.locator('table')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Reopen saved state', exact: true })
    .click();
  await expect(body.locator('td')).toHaveCount(9);
  await expect(body.locator('td').first()).toHaveText('cell');
});
test('table picker keyboard size clamps at one and twelve and grows its grid', async ({
  page,
}) => {
  const { body, picker } = await openTablePicker(page);
  for (let index = 0; index < 15; index++) {
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowLeft');
  }
  await expect(picker.locator('p')).toHaveText('1 × 1');
  await expect(picker.locator('.grid > div')).toHaveCount(36);
  for (let index = 0; index < 15; index++) {
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
  }
  await expect(picker.locator('p')).toHaveText('12 × 12');
  await expect(picker.locator('.grid > div')).toHaveCount(144);
  await page.keyboard.press('Enter');
  await expect(body.locator('tr')).toHaveCount(12);
  await expect(body.locator('td')).toHaveCount(144);
});
test('table picker native pointer or touch chooses the requested row and column', async ({
  page,
  hasTouch,
}) => {
  const { body, picker } = await openTablePicker(page);
  // The production picker grid uses unlabeled divs; this is a geometry/input
  // contract, not grid accessibility acceptance. Initial grid is six columns.
  const cell = picker.locator('.grid > div').nth(9);
  if (hasTouch) await cell.tap();
  else {
    await cell.hover();
    await expect(picker.locator('p')).toHaveText('2 × 4');
    await cell.click();
  }
  await expect(picker).toHaveCount(0);
  await expect(body.locator('tr')).toHaveCount(2);
  await expect(body.locator('td')).toHaveCount(8);
  await expect(body).toBeFocused();
  await page.keyboard.type('chosen');
  await expect(body.locator('td').first()).toHaveText('chosen');
});
test('table picker Escape closes without a table and restores body typing', async ({
  page,
}) => {
  const { body, picker } = await openTablePicker(page);
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(body.locator('table')).toHaveCount(0);
  await expect(body).toBeFocused();
  await page.keyboard.type('after');
  await expect(body).toHaveText('after');
});
test('table picker printable input dismisses and passes text to the editor', async ({
  page,
}) => {
  const { body, picker } = await openTablePicker(page);
  await page.keyboard.type('x');
  await expect(picker).toHaveCount(0);
  await expect(body.locator('table')).toHaveCount(0);
  await expect(body).toHaveText('x');
});
test('table picker outside press dismisses without inserting', async ({
  page,
}) => {
  const { body, picker } = await openTablePicker(page);
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await title.click();
  await expect(picker).toHaveCount(0);
  await expect(body.locator('table')).toHaveCount(0);
  await expect(title).toBeFocused();
});
