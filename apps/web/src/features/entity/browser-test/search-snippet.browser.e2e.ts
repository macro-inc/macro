import { expect, type Locator, type Page, test } from '@playwright/test';

declare global {
  interface Window {
    /** Every URL the page tried to open in a window. */
    __windowOpens: string[];
  }
}

/** Each search row, the link its snippet shows, and what pressing it opens. */
const ROWS = [
  { section: 'list-narrow', href: 'https://app', opens: 'row-narrow' },
  {
    section: 'list-single-line',
    href: 'https://app',
    opens: 'row-single-line',
  },
  { section: 'list-wide', href: 'https://app', opens: 'row-wide' },
  { section: 'content-hit', href: 'https://docs', opens: 'content-hit' },
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
 * its text the row shows. Fails unless that point presses the link or the
 * snippet around it, not something laid over the row. */
async function pressPoint(page: Page, row: (typeof ROWS)[number]) {
  const link = snippetLink(page, row);
  const box = await link.boundingBox();
  const shown = await page.getByTestId(row.section).boundingBox();
  if (!box || !shown) throw new Error('link not laid out');
  const left = Math.max(box.x, shown.x);
  const right = Math.min(box.x + box.width, shown.x + shown.width);
  if (right <= left) throw new Error('link not shown');
  const point = { x: (left + right) / 2, y: box.y + box.height / 2 };
  const pressesSnippet = await link.evaluate((anchor, { x, y }) => {
    const target = document.elementFromPoint(x, y);
    return !!target && (target === anchor || target.contains(anchor));
  }, point);
  if (!pressesSnippet) throw new Error('the press point misses the snippet');
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
