import { expect, test } from '@playwright/test';

for (const mobile of [false, true]) {
  test(`project ranks above cached tasks and inserts a mention on ${mobile ? 'phone' : 'desktop'}`, async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1280, height: 900 },
      isMobile: mobile,
      hasTouch: mobile,
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
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
      `http://localhost:${process.env.CHANNEL_DRAFT_TEST_PORT ?? '3006'}/src/features/channel/Input/browser-test/mention-ranking.html`
    );
    const editor = page.locator('[data-markdown-editable]');
    await expect(editor).toBeVisible({ timeout: 60_000 });
    await editor.click();
    await page.keyboard.type('@');
    await expect(page.locator('.menu-surface')).toBeVisible({
      timeout: 15_000,
    });
    await page.keyboard.type('task');
    const menu = page.locator('.menu-surface');
    const project = menu.getByText('Task planning', { exact: true });
    await expect(project).toBeVisible();
    // The first visible result must be the project even in the unexpanded preview.
    await expect(menu.locator('.group').first()).toContainText('Task planning');
    if (!mobile) {
      await page.keyboard.press('ArrowRight');
      await expect(menu.getByText('Back to everything')).toBeVisible();
      await expect(menu.locator('.group').first()).toContainText(
        'Task planning'
      );
    }
    await page.screenshot({
      path: testInfo.outputPath(
        `mention-ranking-${mobile ? 'phone' : 'desktop'}.png`
      ),
    });
    if (mobile) await project.tap();
    else await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    await expect(editor).toContainText('Task planning');
    await expect(editor).not.toContainText('@task');
    const chip = editor.locator('[data-document-mention][data-document-id]');
    await expect(chip).toHaveAttribute('data-document-id', 'project');
    await expect(chip).toHaveAttribute('data-block-name', 'initiative');
    await expect(page.getByTestId('draft')).toContainText(
      '<m-document-mention>'
    );
    await expect(page.getByTestId('draft')).toContainText(
      '\"blockName\":\"initiative\"'
    );
    expect(errors).toEqual([]);
    await context.close();
  });
}
