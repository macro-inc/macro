import { expect, type Page, test } from '@playwright/test';

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
    body: await page.locator('main').ariaSnapshot(),
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
