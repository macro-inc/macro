import { expect, test } from '@playwright/test';

for (const width of [320, 390]) {
  test(`removes strikethrough from a mobile message edit at ${width}px`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
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
    await page.goto('/src/features/channel/Input/browser-test/draft.html?edit');
    const add = page.getByRole('button', { name: 'Add', exact: true });
    await expect(add).toBeVisible({ timeout: 60_000 });
    await page.locator('[data-collapsed-input-preview]').tap();
    const editor = page.locator('[data-markdown-editable]');
    await expect(editor).toBeFocused();
    await expect(editor).toHaveText('formatted draft');

    // The existing partial selection must survive opening the add drawer.
    await editor.evaluate((element) => {
      const text = document
        .createTreeWalker(element, NodeFilter.SHOW_TEXT)
        .nextNode();
      if (!text) throw new Error('Formatted draft text missing');
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 'formatted'.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
      'formatted'
    );
    await add.tap();
    const format = page.locator('[data-composer-add-item="format-text"]');
    await expect(format).toBeVisible();
    await format.tap();
    const ribbon = page.locator('[data-input-format-ribbon]');
    await expect(ribbon).toBeVisible();
    await expect(editor).toBeFocused();
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
      'formatted'
    );
    await ribbon.tap({ position: { x: 2, y: 2 } });
    await expect(editor).toBeFocused();
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
      'formatted'
    );
    const strike = ribbon.getByRole('button', { name: 'Strikethrough' });
    await expect(strike).toHaveAttribute('aria-pressed', 'true');
    await strike.tap();
    await expect(strike).toHaveAttribute('aria-pressed', 'false');
    await expect(editor).toBeFocused();
    await expect(editor.locator('.md-strike')).toHaveText(' draft');

    // The final control stays reachable without widening the page.
    const quote = ribbon.getByRole('button', { name: 'Blockquote' });
    await quote.scrollIntoViewIfNeeded();
    const bounds = await ribbon.boundingBox();
    if (!bounds) throw new Error('Formatting ribbon has no bounds');
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);

    await add.tap();
    await format.tap();
    await expect(ribbon).toHaveCount(0);
    await expect(editor).toHaveText('formatted draft');
    await page.getByRole('button', { name: 'Send message', exact: true }).tap();
    await expect(page.getByLabel('Sent message')).toHaveText(
      'formatted ~~draft~~'
    );
    await context.close();
  });
}
