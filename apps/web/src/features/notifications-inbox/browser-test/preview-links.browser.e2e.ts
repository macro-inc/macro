import { expect, type Locator, type Page, test } from '@playwright/test';
import { stayLocal } from './stay-local';

const PAGE =
  '/src/features/notifications-inbox/browser-test/notifications-view.html?links';

const ROW_ID = 'dm-links';
const SPEC_URL = 'https://example.test/spec';
const OLDER_URL = 'https://example.test/older';

declare global {
  interface Window {
    __inboxOpened: string[];
    __inboxShown: { row: string; item: string }[];
    /** Every URL the page tried to open in a window. */
    __windowOpens: string[];
  }
}

async function openInbox(page: Page) {
  await page.addInitScript(() => {
    window.__windowOpens = [];
    window.open = (url) => {
      window.__windowOpens.push(String(url));
      return null;
    };
  });
  await stayLocal(page);
  await page.goto(PAGE);
  // The first load pre-bundles the app's dependencies.
  const row = page.locator(`#${ROW_ID}`);
  await row.scrollIntoViewIfNeeded({ timeout: 180_000 });
  await expect(row).toBeVisible();
  return row;
}

/** Where a user would press a link: the middle of its text. */
async function centerOf(link: Locator) {
  const box = await link.boundingBox();
  if (!box) throw new Error('link not laid out');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const windowOpens = (page: Page) => page.evaluate(() => window.__windowOpens);

test.describe('desktop', () => {
  test.use({ viewport: { width: 1100, height: 900 } });

  test('a link in a row previews the row and opens nothing', async ({
    page,
  }) => {
    const row = await openInbox(page);
    const link = row.locator(`a[href="${SPEC_URL}"]`);
    await expect(link).toBeVisible();
    const start = page.url();

    const { x, y } = await centerOf(link);
    await page.mouse.click(x, y);

    await expect
      .poll(() => page.evaluate(() => window.__inboxShown.at(-1)?.row))
      .toBe(ROW_ID);
    expect(await windowOpens(page)).toEqual([]);
    expect(page.url()).toBe(start);
  });

  test('a modified or middle click on a link opens no tab', async ({
    page,
    context,
  }) => {
    const row = await openInbox(page);
    const { x, y } = await centerOf(row.locator(`a[href="${SPEC_URL}"]`));
    const tabs: string[] = [];
    context.on('page', (tab) => tabs.push(tab.url()));

    await page.keyboard.down('ControlOrMeta');
    await page.mouse.click(x, y);
    await page.keyboard.up('ControlOrMeta');
    await page.mouse.click(x, y, { button: 'middle' });

    // A tab opened by either click exists by the time another row answers.
    await page.locator('#dm-ana').click();
    await expect
      .poll(() => page.evaluate(() => window.__inboxShown.at(-1)?.row))
      .toBe('dm-ana');
    expect(tabs).toEqual([]);
    expect(await windowOpens(page)).toEqual([]);
  });

  test('a link in an unfolded stack previews its notification', async ({
    page,
  }) => {
    const row = await openInbox(page);
    await row.getByRole('button', { name: /2 notifications/ }).click();
    const item = page.locator(`[data-stack-item]:has(a[href="${OLDER_URL}"])`);
    const link = item.locator(`a[href="${OLDER_URL}"]`);
    await link.scrollIntoViewIfNeeded();

    const { x, y } = await centerOf(link);
    await page.mouse.click(x, y);

    await expect
      .poll(() => page.evaluate(() => window.__inboxShown.at(-1)))
      .toEqual({ row: ROW_ID, item: `${ROW_ID}-2` });
    expect(await windowOpens(page)).toEqual([]);
  });

  test('Tab never stops on a link in a row', async ({ page }) => {
    const row = await openInbox(page);
    const link = row.locator(`a[href="${SPEC_URL}"]`);

    await link.focus();

    await expect(link).not.toBeFocused();
  });
});

test.describe('phone', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test('tapping a link in a row opens the row, not the link', async ({
    page,
  }) => {
    const row = await openInbox(page);
    const { x, y } = await centerOf(row.locator(`a[href="${SPEC_URL}"]`));

    await page.touchscreen.tap(x, y);

    await expect
      .poll(() => page.evaluate(() => window.__inboxOpened))
      .toEqual([ROW_ID]);
    expect(await windowOpens(page)).toEqual([]);
  });
});
