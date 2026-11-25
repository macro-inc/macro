import { expect, type Page, test } from '@playwright/test';

/**
 * On the folded iPhone Duo the clock and camera column is a right safe area
 * the app frame pads. Chrome drawn inside a pane must line up with the pane,
 * not add that column again, and the top fade must continue across it.
 */

const SAFE_RIGHT = 84;
const HEADER = 56;
const BOTTOM_CHROME = 90;
const GUTTER = 12;

const rect = (page: Page, selector: string) =>
  page.evaluate((selector) => {
    const element = document.querySelector(selector);
    if (!element) return undefined;
    const { left, right, top, bottom, width, height } =
      element.getBoundingClientRect();
    return { left, right, top, bottom, width, height };
  }, selector);

const scrollUp = async (page: Page) => {
  await expect(page.locator('[data-message="message-119"]')).toBeVisible();
  await page.evaluate(() => {
    const scroller = document.querySelector('[data-channel-scroll]');
    scroller?.scrollBy({ top: -1500 });
  });
};

for (const safeRight of [0, SAFE_RIGHT]) {
  test.describe(`with a ${safeRight}px right safe area`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/side-safe-area.html?safeRight=${safeRight}`);
      await scrollUp(page);
    });

    test('the jump-to-latest button sits one gutter in from the pane edge', async ({
      page,
    }) => {
      await expect(
        page.getByRole('button', { name: 'Jump to latest' })
      ).toBeVisible();
      const pane = await rect(page, '[data-pane]');
      const button = await rect(page, '[data-scroll-to-bottom]');
      expect(pane?.right).toBe(page.viewportSize()!.width - safeRight);
      expect(button?.right).toBeCloseTo((pane?.right ?? 0) - GUTTER, 0);
    });

    test('the scroll bar runs between the header and the bottom chrome', async ({
      page,
    }) => {
      const pane = await rect(page, '[data-pane]');
      const track = await page.evaluate(() => {
        const gutter = [
          ...document.querySelectorAll<HTMLElement>('[aria-hidden="true"]'),
        ].find((element) => element.style.touchAction === 'none');
        const box = gutter?.getBoundingClientRect();
        return box && { top: box.top, bottom: box.bottom };
      });
      expect(track?.top).toBeCloseTo((pane?.top ?? 0) + HEADER, 0);
      expect(track?.bottom).toBeCloseTo((pane?.bottom ?? 0) - BOTTOM_CHROME, 0);
    });
  });
}

test('the top fade continues across the right safe area in the same colour', async ({
  page,
}) => {
  await page.goto(`/side-safe-area.html?safeRight=${SAFE_RIGHT}`);
  await scrollUp(page);
  const fade = await rect(page, '[data-mobile-top-edge-fade]');
  await expect(page.locator('[data-mobile-top-edge-fade-column]')).toHaveCount(
    1
  );
  const column = await rect(page, '[data-mobile-top-edge-fade-column]');
  expect(column).toEqual({
    left: fade?.right,
    right: page.viewportSize()!.width,
    top: fade?.top,
    bottom: fade?.bottom,
    width: SAFE_RIGHT,
    height: fade?.height,
  });
  const backgrounds = await page.evaluate(() =>
    ['[data-mobile-top-edge-fade]', '[data-mobile-top-edge-fade-column]'].map(
      (selector) => {
        const element = document.querySelector(selector);
        return element ? getComputedStyle(element).backgroundImage : undefined;
      }
    )
  );
  expect(backgrounds[0]).toBeTruthy();
  expect(backgrounds[1]).toBe(backgrounds[0]);
});

test('a pane with no side safe area draws no column fade', async ({ page }) => {
  await page.goto('/side-safe-area.html');
  await scrollUp(page);
  await expect(page.locator('[data-mobile-top-edge-fade]')).toBeVisible();
  await expect(page.locator('[data-mobile-top-edge-fade-column]')).toHaveCount(
    0
  );
});

test('a pane parked under another draws no column fade of its own', async ({
  page,
}) => {
  await page.goto(`/side-safe-area.html?safeRight=${SAFE_RIGHT}&stacked`);
  await scrollUp(page);
  const visibleColumns = page.locator('[data-mobile-top-edge-fade-column]');
  const park = (parked: boolean) =>
    page.evaluate((parked) => window.setParked?.(parked), parked);
  await expect(visibleColumns).toHaveCount(1);
  // Opening and closing a detail over a list hides and shows the list without
  // resizing it.
  await park(false);
  await expect(visibleColumns).toHaveCount(2);
  await park(true);
  await expect(visibleColumns).toHaveCount(1);
  const column = await rect(page, '[data-mobile-top-edge-fade-column]');
  const fade = await rect(page, '[data-pane] [data-mobile-top-edge-fade]');
  expect(column?.left).toBe(page.viewportSize()!.width - SAFE_RIGHT);
  expect(column?.top).toBe(fade?.top);
});

test('turning the phone over moves the column fade to the other side', async ({
  page,
}) => {
  await page.goto(`/side-safe-area.html?safeRight=${SAFE_RIGHT}`);
  await scrollUp(page);
  await expect(page.locator('[data-mobile-top-edge-fade-column]')).toHaveCount(
    1
  );
  // The frame's padding swaps sides: the pane keeps its size and only moves.
  await page.evaluate((inset) => {
    const style = document.documentElement.style;
    style.setProperty('--safe-right', '0px');
    style.setProperty('--safe-left', `${inset}px`);
  }, SAFE_RIGHT);
  await expect(page.locator('[data-mobile-top-edge-fade-column]')).toHaveCount(
    1
  );
  const column = await rect(page, '[data-mobile-top-edge-fade-column]');
  expect(column?.left).toBe(0);
  expect(column?.width).toBe(SAFE_RIGHT);
});

test('a pane sliding back into place picks the column fade back up', async ({
  page,
}) => {
  await page.goto(`/side-safe-area.html?safeLeft=${SAFE_RIGHT}`);
  await scrollUp(page);
  const columns = page.locator('[data-mobile-top-edge-fade-column]');
  await expect(columns).toHaveCount(1);
  const slide = (transform: string) =>
    page.evaluate((transform) => {
      const pane = document.querySelector<HTMLElement>('[data-pane]');
      if (pane) pane.style.transform = transform;
    }, transform);
  // A swipe back moves the revealed pane with a transform, never resizing it.
  await slide('translateX(200px)');
  await expect(columns).toHaveCount(0);
  await slide('');
  await expect(columns).toHaveCount(1);
  const column = await rect(page, '[data-mobile-top-edge-fade-column]');
  expect(column?.left).toBe(0);
  expect(column?.width).toBe(SAFE_RIGHT);
});
