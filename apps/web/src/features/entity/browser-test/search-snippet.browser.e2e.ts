import { expect, type Locator, type Page, test } from '@playwright/test';

declare global {
  interface Window {
    /** Every URL the page tried to open in a window. */
    __windowOpens: string[];
  }
}

/** Each search row, the link its snippet or highlighted title shows, and what
 * pressing it opens. */
const ROWS = [
  { section: 'list-narrow', href: 'https://app', opens: 'row-narrow' },
  {
    section: 'list-single-line',
    href: 'https://app',
    opens: 'row-single-line',
  },
  { section: 'list-wide', href: 'https://app', opens: 'row-wide' },
  { section: 'list-phone', href: 'https://app', opens: 'row-phone' },
  { section: 'content-hit', href: 'https://docs', opens: 'content-hit' },
  {
    section: 'list-title-single-line',
    href: 'https://app',
    opens: 'row-title-single-line',
  },
  { section: 'list-title-wide', href: 'https://app', opens: 'row-title-wide' },
];

async function openFixture(page: Page) {
  await page.addInitScript(() => {
    window.__windowOpens = [];
    window.open = (url) => {
      window.__windowOpens.push(String(url));
      return null;
    };
  });
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).hostname === 'localhost')
      await route.continue();
    else await route.fulfill({ status: 401, body: '{}' });
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.goto('/src/features/entity/browser-test/search-snippet.html');
  // The first load pre-bundles the app's dependencies.
  await expect(highlight(page.getByTestId('list-wide'))).toBeVisible({
    timeout: 60_000,
  });
}

/** The highlighted match in a section's rendered snippet. */
function highlight(section: Locator) {
  return section.locator('.markdown-content').getByText('sketchpad');
}

/** The part of the snippet markdown turns into a link: the URL up to the
 * highlight that splits it. */
function snippetLink(page: Page, row: (typeof ROWS)[number]) {
  return page.getByTestId(row.section).locator(`a[href^="${row.href}"]`);
}

/** Where a user would press a row's snippet link: the middle of the part of
 * it the row shows, inside every box that clips it. Fails unless that point
 * reaches the link or, when the link is inert, the snippet holding it, rather
 * than something laid over the row. */
async function pressPoint(page: Page, row: (typeof ROWS)[number]) {
  const point = await snippetLink(page, row).evaluate((anchor) => {
    const box = anchor.getBoundingClientRect();
    let left = Math.max(box.left, 0);
    let right = Math.min(box.right, window.innerWidth);
    for (let el = anchor.parentElement; el; el = el.parentElement) {
      if (getComputedStyle(el).overflowX === 'visible') continue;
      const clip = el.getBoundingClientRect();
      left = Math.max(left, clip.left);
      right = Math.min(right, clip.right);
    }
    if (right - left < 4) return null;
    const x = (left + right) / 2;
    const y = (box.top + box.bottom) / 2;
    const target = document.elementFromPoint(x, y);
    if (!target) return null;
    return anchor.contains(target) || target.contains(anchor) ? { x, y } : null;
  });
  if (!point) throw new Error('no shown part of the link takes the press');
  return point;
}

const opened = (page: Page) => page.getByLabel('Opened');
const windowOpens = (page: Page) => page.evaluate(() => window.__windowOpens);

test.describe('desktop', () => {
  test.use({ viewport: { width: 1100, height: 900 } });

  for (const row of ROWS) {
    test(`pressing the link in a ${row.section} snippet opens the result`, async ({
      page,
    }) => {
      await openFixture(page);
      const start = page.url();
      const { x, y } = await pressPoint(page, row);

      await page.mouse.click(x, y);

      await expect(opened(page)).toHaveText(row.opens);
      expect(await windowOpens(page)).toEqual([]);
      expect(page.url()).toBe(start);
    });
  }

  test('a modified or middle click on a snippet link opens no tab', async ({
    page,
    context,
  }) => {
    await openFixture(page);
    const tabs: string[] = [];
    context.on('page', (tab) => tabs.push(tab.url()));

    for (const row of ROWS) {
      const { x, y } = await pressPoint(page, row);
      await page.keyboard.down('ControlOrMeta');
      await page.mouse.click(x, y);
      await page.keyboard.up('ControlOrMeta');
      await page.mouse.click(x, y, { button: 'middle' });
    }

    expect(await windowOpens(page)).toEqual([]);
    expect(tabs).toEqual([]);
  });

  test('a snippet still reads as its text, highlight included', async ({
    page,
  }) => {
    await openFixture(page);
    const wide = page.getByTestId('list-wide');
    await expect(highlight(wide)).toBeVisible();
    await expect(wide).toContainText('https://app.sketchpad.example/file/0ABC');
  });
});

test.describe('phone', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test('the phone row is as wide as the screen', async ({ page }) => {
    await openFixture(page);
    const row = await page.getByTestId('list-phone').boundingBox();
    expect(row?.width).toBe(390);
  });

  for (const row of ROWS) {
    test(`tapping the link in a ${row.section} snippet opens the result`, async ({
      page,
    }) => {
      await openFixture(page);
      const { x, y } = await pressPoint(page, row);

      await page.touchscreen.tap(x, y);

      await expect(opened(page)).toHaveText(row.opens);
      expect(await windowOpens(page)).toEqual([]);
    });
  }
});
