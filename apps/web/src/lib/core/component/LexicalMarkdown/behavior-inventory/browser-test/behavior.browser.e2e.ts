import { expect, type Locator, type Page, test } from '@playwright/test';

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

const PAGE_ERRORS = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  PAGE_ERRORS.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.routeWebSocket(
    (url) => url.hostname !== '127.0.0.1',
    (socket) => socket.close()
  );
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
});

test.afterEach(async ({ page }, info) => {
  await info.attach('accessibility', {
    body: await page.locator('body').ariaSnapshot(),
    contentType: 'text/plain',
  });
  await info.attach('pixels', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.getByRole('button', { name: 'Save state', exact: true }).click();
  await info.attach('serialized-and-markdown', {
    body: await page.locator('#saved').innerText(),
    contentType: 'application/json',
  });
  expect(PAGE_ERRORS.get(page)).toEqual([]);
});

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

test('slash menu Tab and ShiftTab navigate and ArrowUp wraps to checklist', async ({
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
  await page.keyboard.press('ArrowUp');
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
