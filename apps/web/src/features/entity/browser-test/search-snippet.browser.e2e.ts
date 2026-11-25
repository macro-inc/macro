import { expect, type Locator, type Page, test } from '@playwright/test';

declare global {
  interface Window {
    /** Every URL the page tried to open in a window. */
    __windowOpens: string[];
  }
}

/** Each search row, the link its snippet or highlighted name shows, and what
 * pressing it opens. The screen-wide phone row only exists on a phone. */
const ROWS = [
  { section: 'list-narrow', href: 'https://app', opens: 'row-narrow' },
  {
    section: 'list-single-line',
    href: 'https://app',
    opens: 'row-single-line',
  },
  { section: 'list-wide', href: 'https://app', opens: 'row-wide' },
  {
    section: 'list-phone',
    href: 'https://app',
    opens: 'row-phone',
    phoneOnly: true,
  },
  { section: 'content-hit', href: 'https://docs', opens: 'content-hit' },
  {
    section: 'list-title-single-line',
    href: 'https://app',
    opens: 'row-title-single-line',
  },
  { section: 'list-title-wide', href: 'https://app', opens: 'row-title-wide' },
  {
    section: 'list-call-narrow',
    href: 'https://meet',
    opens: 'row-call-narrow',
  },
  { section: 'list-call-wide', href: 'https://meet', opens: 'row-call-wide' },
];

const DESKTOP_ROWS = ROWS.filter((row) => !row.phoneOnly);

/** Each wide row, the whole URL a screen reader should read in it, and the
 * highlighted match inside that URL. */
const READ_TEXT = [
  {
    section: 'list-wide',
    text: 'https://app.sketchpad.example/file/0ABC',
    match: 'sketchpad',
  },
  {
    section: 'list-title-wide',
    text: 'https://app.planbook.example/roadmap',
    match: 'planbook',
  },
  {
    section: 'list-call-wide',
    text: 'https://meet.dialtone.example/r/42',
    match: 'dialtone',
  },
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

/** The part of the text markdown turns into a link: the URL up to the
 * highlight that splits it. */
function rowLink(page: Page, row: (typeof ROWS)[number]) {
  return page.getByTestId(row.section).locator(`a[href^="${row.href}"]`);
}

/** Where a user would press a row's link: the middle of the part of its first
 * line the row shows, inside every box that clips it. Fails unless that point
 * reaches the link itself or, when the link is inert, the element its inert
 * text sits in, rather than anything else on or over the row. */
async function pressPoint(page: Page, row: (typeof ROWS)[number]) {
  const point = await rowLink(page, row).evaluate((anchor) => {
    const line = anchor.getClientRects()[0];
    if (!line) return null;
    let { left, right, top, bottom } = line;
    left = Math.max(left, 0);
    top = Math.max(top, 0);
    right = Math.min(right, window.innerWidth);
    bottom = Math.min(bottom, window.innerHeight);
    for (let el = anchor.parentElement; el; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (style.overflowX === 'visible' && style.overflowY === 'visible')
        continue;
      const clip = el.getBoundingClientRect();
      left = Math.max(left, clip.left);
      right = Math.min(right, clip.right);
      top = Math.max(top, clip.top);
      bottom = Math.min(bottom, clip.bottom);
    }
    if (right - left < 4 || bottom - top < 4) return null;
    const x = (left + right) / 2;
    const y = (top + bottom) / 2;
    const target = document.elementFromPoint(x, y);
    if (!target) return null;
    const inertHolder = anchor.closest('[inert]')?.parentElement;
    return anchor.contains(target) || target === inertHolder ? { x, y } : null;
  });
  if (!point) throw new Error('no shown part of the link takes the press');
  return point;
}

/** Chromium's own accessibility tree, which leaves out inert content;
 * Playwright's aria snapshot does not. */
async function accessibilityTree(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  await cdp.detach();
  return nodes
    .filter((node) => !node.ignored)
    .map((node) => ({
      role: String(node.role?.value ?? ''),
      name: String(node.name?.value ?? ''),
    }));
}

const opened = (page: Page) => page.getByLabel('Opened');
const windowOpens = (page: Page) => page.evaluate(() => window.__windowOpens);

test.describe('desktop', () => {
  test.use({ viewport: { width: 1100, height: 900 } });

  for (const row of DESKTOP_ROWS) {
    test(`pressing the link in the ${row.section} row opens the result`, async ({
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

  test('a modified or middle click on a row link opens no tab', async ({
    page,
    context,
  }) => {
    await openFixture(page);
    const tabs: string[] = [];
    context.on('page', (tab) => tabs.push(tab.url()));

    for (const row of DESKTOP_ROWS) {
      const { x, y } = await pressPoint(page, row);
      await page.keyboard.down('ControlOrMeta');
      await page.mouse.click(x, y);
      await page.keyboard.up('ControlOrMeta');
      await page.mouse.click(x, y, { button: 'middle' });

      expect(await windowOpens(page)).toEqual([]);
      expect(tabs).toEqual([]);
    }
  });

  test('a link still shows as link text with its highlight', async ({
    page,
  }) => {
    await openFixture(page);
    for (const { section, match } of READ_TEXT) {
      const shown = page.getByTestId(section).locator('.markdown-content');
      await expect(shown.locator('a[href^="https://"]')).toBeVisible();
      await expect(shown.getByText(match)).toBeVisible();
    }
  });

  test('a screen reader reads each link as its text, not as a link', async ({
    page,
  }) => {
    await openFixture(page);
    const tree = await accessibilityTree(page);
    for (const { text } of READ_TEXT) {
      expect(tree.some((node) => node.name.includes(text))).toBe(true);
    }
    expect(
      tree.filter((node) => node.role === 'link' && /^https?:/.test(node.name))
    ).toEqual([]);
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
    test(`tapping the link in the ${row.section} row opens the result`, async ({
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
