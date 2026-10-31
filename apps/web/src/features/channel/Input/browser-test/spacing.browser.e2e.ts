import { expect, test } from '@playwright/test';

/** Distance in pixels between the tops of a box's rendered text lines. */
const lineGaps = (selector: string) => {
  const box = document.querySelector(selector);
  if (!box) throw new Error(`No ${selector}`);
  const range = document.createRange();
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  const tops: number[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    range.selectNodeContents(node);
    tops.push(Math.round(range.getBoundingClientRect().top));
  }
  const sorted = [...new Set(tops)].sort((a, b) => a - b);
  return sorted.slice(1).map((top, index) => top - sorted[index]);
};

test('a sent message keeps the line spacing of the draft that wrote it', async ({
  page,
}) => {
  // The composer and the message renderer run over synthetic props; no hosted
  // data is read or written.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost') {
      await route.continue();
    } else {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ responses: [] }),
      });
    }
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.goto('/src/features/channel/Input/browser-test/spacing.html');

  const editor = page.locator('[data-markdown-editable]');
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();
  // Shift+Enter is the composer's newline; Enter sends. Two in a row leave a
  // blank line.
  await page.keyboard.type('Line 1');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('Line 2');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('Line 4');

  const draftGaps = await page.evaluate(lineGaps, '[data-markdown-editable]');
  // One line down, then a line and the blank one between.
  expect(draftGaps).toHaveLength(2);
  expect(draftGaps[1]).toBeGreaterThan(draftGaps[0] * 1.5);

  await page.keyboard.press('Enter');
  await expect(page.locator('[data-sent-message]')).toHaveCount(1);

  const messageGaps = await page.evaluate(lineGaps, '[data-sent-message]');
  // The composer's line height is a fraction of a pixel off the message's.
  expect(messageGaps).toHaveLength(draftGaps.length);
  for (const [index, gap] of messageGaps.entries()) {
    expect(Math.abs(gap - draftGaps[index])).toBeLessThanOrEqual(1);
  }
});
