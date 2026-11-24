import { expect, type Page, test } from '@playwright/test';

declare global {
  interface Window {
    scrollEnds: number;
  }
}

test.beforeEach(async ({ page }) => {
  // The fixture's providers would otherwise reach the hosted dev backend.
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('**/__macro_dev/**', (route) => route.abort());
  await page.route('https://**', (route) => route.abort());
  await page.goto('/src/features/block-email/browser-test/page-keys.html');
  await expect(
    page.getByText('Second message, paragraph 40 of the update.')
  ).toBeAttached();
  // Count the list's settled scrolls, so each check reads where a smooth
  // scroll ends rather than a frame of it.
  await messageList(page).evaluate((list) => {
    window.scrollEnds = 0;
    list.addEventListener('scrollend', () => {
      window.scrollEnds += 1;
    });
  });
});

const messageList = (page: Page) =>
  page
    .locator('[data-message-body-id]')
    .first()
    .locator('xpath=ancestor::div[contains(@class, "overflow-y-scroll")][1]');

const scrollEnds = (page: Page) => page.evaluate(() => window.scrollEnds);

const position = (page: Page) =>
  messageList(page).evaluate((list) => ({
    top: list.scrollTop,
    height: list.clientHeight,
  }));

/** Presses `key` and returns where the list settles. */
async function pressAndSettle(page: Page, key: string) {
  const before = await scrollEnds(page);
  await page.keyboard.press(key);
  await expect.poll(() => scrollEnds(page)).toBe(before + 1);
  return position(page);
}

// When this fails, Space in an open thread does nothing until the reader
// clicks into a message: the keyboard rests on the host's frame, outside the
// list that scrolls, so the browser's own Space has nothing to scroll.
test('Space pages the thread down and Shift+Space back up, from the open thread', async ({
  page,
}) => {
  await expect(page.getByTestId('thread-frame')).toBeFocused();
  expect((await position(page)).top).toBe(0);

  const first = await pressAndSettle(page, 'Space');
  // About a screen, keeping a little of the last one on screen.
  expect(first.top).toBeGreaterThan(first.height / 2);
  expect(first.top).toBeLessThan(first.height);

  const second = await pressAndSettle(page, 'Space');
  expect(second.top).toBeCloseTo(first.top * 2, 0);

  expect((await pressAndSettle(page, 'Shift+Space')).top).toBeCloseTo(
    first.top,
    0
  );
  expect((await pressAndSettle(page, 'Shift+Space')).top).toBe(0);
});

// When this fails, a second tap of Space soon after the first is dropped:
// with reduced motion every page lands at once, so the reader sees it ignored.
test('every tap of Space pages, with reduced motion too', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('Space');
  await page.keyboard.press('Space');
  // Two pages, each more than half the list's height.
  await expect
    .poll(async () => {
      const { top, height } = await position(page);
      return top > height;
    })
    .toBe(true);
});

// When this fails, paging takes Space from what has the keyboard: a focused
// button no longer presses, or a typed space never reaches a field or the
// reply composer.
test('Space presses a focused button and types in fields and the reply', async ({
  page,
}) => {
  const button = page.getByRole('button', { name: 'Header action' });
  await button.focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('header-clicks')).toHaveText('1');

  const field = page.getByRole('textbox', { name: 'Header field' });
  await field.click();
  await page.keyboard.type('a b');
  await expect(field).toHaveValue('a b');
  expect(await scrollEnds(page)).toBe(0);

  await page.getByTestId('thread-frame').focus();
  await page.keyboard.press('r');
  const reply = page.locator('[contenteditable="true"]');
  await expect(reply).toBeFocused();
  await page.keyboard.type('Sounds good to me');
  await expect(reply).toContainText('Sounds good to me');
});
