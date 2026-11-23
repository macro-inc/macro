import { expect, type Page, test } from '@playwright/test';

/** The first message whose top is inside the scroller, with that top's offset. */
const readingAnchor = (page: Page) =>
  page.evaluate(() => {
    const scroller = document.querySelector('[data-channel-scroll]');
    if (!scroller) throw new Error('No scroller');
    const top = scroller.getBoundingClientRect().top;
    const [first] = [
      ...document.querySelectorAll<HTMLElement>('[data-message]'),
    ]
      .map((row) => ({
        id: row.dataset.message ?? '',
        offset: row.getBoundingClientRect().top - top,
      }))
      .filter((row) => row.offset >= 0)
      .sort((a, b) => a.offset - b.offset);
    if (!first) throw new Error('No visible message');
    return first;
  });

const offsetOf = (page: Page, id: string) =>
  page.evaluate((id) => {
    const scroller = document.querySelector('[data-channel-scroll]');
    const row = document.querySelector(`[data-message="${id}"]`);
    if (!scroller || !row) return undefined;
    return (
      row.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    );
  }, id);

const distanceFromBottom = (page: Page) =>
  page.evaluate(() => {
    const scroller = document.querySelector('[data-channel-scroll]');
    if (!scroller) throw new Error('No scroller');
    return scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
  });

const settle = async (page: Page) => {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  await page.waitForTimeout(200);
};

/** Opening a session beside the channel narrows its pane; closing it widens it again. */
const setPaneWidth = async (page: Page, width: string) => {
  await page.evaluate((width) => window.setPaneWidth(width), width);
  await settle(page);
};

const readHistory = async (page: Page) => {
  await page.goto('/');
  await expect(page.locator('[data-message="message-199"]')).toBeVisible();
  await page.locator('[data-channel-scroll]').hover();
  for (let step = 0; step < 12; step++) {
    await page.mouse.wheel(0, -800);
    await settle(page);
  }
  await page.waitForTimeout(300);
};

const expectAnchorKept = async (
  page: Page,
  anchor: { id: string; offset: number }
) => {
  const offset = await offsetOf(page, anchor.id);
  expect(offset).toBeDefined();
  expect(Math.abs((offset ?? Infinity) - anchor.offset)).toBeLessThanOrEqual(1);
};

test('narrowing and widening the pane keeps the message being read in place', async ({
  page,
}) => {
  await readHistory(page);
  const anchor = await readingAnchor(page);

  await setPaneWidth(page, '50%');
  await expectAnchorKept(page, anchor);

  await setPaneWidth(page, '100%');
  await expectAnchorKept(page, anchor);
});

test('reopening the channel at another width keeps the message being read in place', async ({
  page,
}) => {
  await readHistory(page);
  const anchor = await readingAnchor(page);

  // Restored row sizes were measured at the old width and rewrap on mount.
  await page.evaluate(() => {
    window.setPaneWidth('50%');
    window.reopenChannel();
  });
  await settle(page);
  await expectAnchorKept(page, anchor);
});

test('scrolling up after the pane narrows moves only by the scroll', async ({
  page,
}) => {
  await readHistory(page);
  await setPaneWidth(page, '50%');
  await page.locator('[data-channel-scroll]').hover();

  // Rows above were measured at the old width and rewrap as they mount.
  for (let step = 0; step < 10; step++) {
    const anchor = await readingAnchor(page);
    await page.mouse.wheel(0, -300);
    await settle(page);
    await expectAnchorKept(page, { ...anchor, offset: anchor.offset + 300 });
  }
});

test('a pane that narrows at the latest message stays at the latest message', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('[data-message="message-199"]')).toBeVisible();

  await setPaneWidth(page, '50%');
  expect(await distanceFromBottom(page)).toBeLessThanOrEqual(1);
  await expect(page.locator('[data-message="message-199"]')).toBeInViewport();
});
