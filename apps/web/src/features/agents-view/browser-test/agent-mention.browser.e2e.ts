import { expect, type Page, test } from '@playwright/test';

const PORT = process.env.AGENT_MENTION_TEST_PORT ?? '3007';

async function openFixture(page: Page) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (
      url.hostname === 'localhost' &&
      !url.pathname.startsWith('/__macro_dev/')
    ) {
      await route.continue();
    } else {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{"responses":[]}',
      });
    }
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.goto(
    `http://localhost:${PORT}/src/features/agents-view/browser-test/agent-mention.html`
  );
  const editor = page.locator('[data-markdown-editable]');
  await expect(editor).toBeVisible({ timeout: 180_000 });
  return editor;
}

test('picking an agent from @ selects it and leaves only the prompt', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const editor = await openFixture(page);
  await editor.click();
  await page.keyboard.type('fix the build @');

  const menu = page.locator('.menu-surface');
  await expect(menu.getByText('Agents', { exact: false })).toBeVisible({
    timeout: 15_000,
  });
  await expect(menu.getByText('Reviewer')).toBeVisible();
  await expect(menu.getByText('Offline')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('agent-menu.png') });

  await page.keyboard.type('curs');
  await expect(menu.locator('.group').first()).toContainText('Cursor');
  await page.keyboard.press('Enter');

  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'Code' })).toBeChecked();
  await expect(editor).toHaveText('fix the build ');
  await expect(editor.locator('[data-user-mention]')).toHaveCount(0);
  await expect(editor).toBeFocused();

  await page.keyboard.type('now');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('started')).toHaveText(
    JSON.stringify({
      prompt: 'fix the build now',
      botId: '00000000-0000-0000-0000-00000000c5c5',
    })
  );
  expect(errors).toEqual([]);
});

test('an offline agent cannot be picked on a phone', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const editor = await openFixture(page);
  await editor.tap();
  await page.keyboard.type('@');

  const menu = page.locator('.menu-surface');
  await expect(menu.getByText('Reviewer')).toBeVisible({ timeout: 15_000 });
  await expect(menu.locator('.group').first()).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('agent-menu-phone.png'),
  });

  await menu.getByText('Dev box').tap();
  await expect(menu).toBeVisible();
  await menu.getByText('Reviewer').tap();
  await expect(menu).toHaveCount(0);
  await expect(editor).not.toContainText('@');
  await context.close();
});
