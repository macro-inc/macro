import { expect, type Page, test } from '@playwright/test';

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const failures: string[] = [];
  errors.set(page, failures);
  page.on('pageerror', (error) => failures.push(error.message));
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (url.pathname === '/auth/user/profile_pictures')
      return route.fulfill({ json: { pictures: [] } });
    return route.continue();
  });
});
test.afterEach(async ({ page }, info) => {
  await info.attach('native-page', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  expect(errors.get(page)).toEqual([]);
});

async function body(page: Page) {
  await page.goto('/user-mentions.html?engine=native&emoji=1');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  const editor = page.getByRole('textbox', { name: 'Body', exact: true });
  await editor.click();
  return editor;
}

test('native : opens the emoji picker and Enter inserts the choice', async ({
  page,
}) => {
  const editor = await body(page);
  await page.keyboard.type('hi :grin');
  const picker = page.locator('.menu-surface');
  await expect(picker).toBeVisible();
  await expect(picker).toContainText('grin');
  await page.keyboard.press('Enter');
  await expect(picker).toHaveCount(0);
  await expect(page.locator('#live-state')).not.toContainText('inline-search');
  await expect(editor).toHaveText(/^hi \p{Extended_Pictographic}/u);
});

test('native : closing shortcode resolves the emoji', async ({ page }) => {
  const editor = await body(page);
  await page.keyboard.type('hi :smile');
  // Source resolves only once the lazy emoji catalog has loaded.
  await expect(page.locator('.menu-surface')).toContainText('smile');
  await page.keyboard.type(':');
  await expect(page.locator('#live-state')).not.toContainText('inline-search');
  await expect(editor).toHaveText('hi 😄');
});

for (const [key, bit] of [
  ['b', 1],
  ['e', 16],
  ['Shift+x', 4],
  ['Shift+h', 128],
] as const) {
  test(`native Control+${key} formats the selection with bit ${bit}`, async ({
    page,
  }) => {
    await body(page);
    await page.keyboard.type('word');
    await page.keyboard.press('Shift+Home');
    await page.keyboard.press(`ControlOrMeta+${key}`);
    await expect(page.locator('#live-state')).toContainText(`"format":${bit}`);
    expect(await page.evaluate(() => document.getSelection()?.toString())).toBe(
      'word'
    );
  });
}
