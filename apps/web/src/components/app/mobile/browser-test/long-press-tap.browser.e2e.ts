import { type CDPSession, expect, type Page, test } from '@playwright/test';

/**
 * After a long press opens a Mail row's action drawer and the drawer is
 * dismissed, a tap on any row presses that row alone: the long-pressed row
 * never takes the press again, and no part of it draws WebKit's tap
 * highlight, which iOS otherwise flashes over it on later taps.
 */

type Point = { x: number; y: number };
type Mark = { row: string; pressed: boolean; rect: number[] };

const touch = (
  cdp: CDPSession,
  type: 'touchStart' | 'touchEnd',
  point?: Point
) =>
  cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: point ? [point] : [],
  });

async function centre(page: Page, id: string): Promise<Point> {
  const box = await page.locator(`[role="row"][id="${id}"]`).boundingBox();
  if (!box) throw new Error(`${id} is not rendered`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Record every change of the pressed marker, on any element, from now on. */
const watchPresses = (page: Page) =>
  page.evaluate(() => {
    const marks: Mark[] = [];
    (window as unknown as { marks: Mark[] }).marks = marks;
    new MutationObserver((records) => {
      for (const record of records) {
        const element = record.target as Element;
        const pressed = element.classList.contains('touch-highlight');
        const was = (record.oldValue ?? '')
          .split(' ')
          .includes('touch-highlight');
        if (pressed === was) continue;
        const box = element.getBoundingClientRect();
        marks.push({
          row: element.closest('[role="row"][id]')?.id ?? element.tagName,
          pressed,
          rect: [box.left, box.top, box.width, box.height].map(Math.round),
        });
      }
    }).observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
      attributeOldValue: true,
      subtree: true,
    });
  });

const marks = (page: Page) =>
  page.evaluate(() => (window as unknown as { marks: Mark[] }).marks);

const rowRect = (page: Page, id: string) =>
  page
    .locator(`[role="row"][id="${id}"]`)
    .evaluate((row) =>
      [
        row.getBoundingClientRect().left,
        row.getBoundingClientRect().top,
        row.getBoundingClientRect().width,
        row.getBoundingClientRect().height,
      ].map(Math.round)
    );

test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.protocol !== 'https:') {
      return route.continue();
    }
    return route.abort('blockedbyclient');
  });
  await page.goto('/email-press.html');
  await expect(page.locator('[role="row"][id="mail-6"]')).toBeVisible({
    timeout: 60_000,
  });
});

test('after a dismissed long-press drawer, a tap presses only the tapped row', async ({
  page,
}) => {
  const cdp = await page.context().newCDPSession(page);
  const drawer = page.locator('[data-corvu-drawer-content]');

  await touch(cdp, 'touchStart', await centre(page, 'mail-2'));
  await expect(drawer).toBeVisible();
  await touch(cdp, 'touchEnd');

  // Dismiss on the backdrop, well above the drawer.
  const top = (await drawer.boundingBox())?.y ?? 0;
  expect(top).toBeGreaterThan(80);
  await touch(cdp, 'touchStart', { x: 200, y: top / 2 });
  await touch(cdp, 'touchEnd');
  await expect(drawer).toHaveCount(0);
  await expect(page.locator('main')).toHaveAttribute('data-opened', '');

  await watchPresses(page);
  for (const row of ['mail-6', 'mail-4']) {
    await touch(cdp, 'touchStart', await centre(page, row));
    await page.waitForTimeout(40);
    await touch(cdp, 'touchEnd');
    await expect(page.locator('main')).toHaveAttribute('data-opened', row);
    const rect = await rowRect(page, row);
    const pressed = (await marks(page)).filter((mark) => mark.pressed);
    // Only the tapped row is pressed, at the tapped row's place.
    expect(pressed.at(-1)).toEqual({ row, pressed: true, rect });
    expect(pressed.map((mark) => mark.row)).not.toContain('mail-2');
    await expect
      .poll(async () => (await marks(page)).at(-1)?.pressed)
      .toBe(false);
  }
  expect(
    (await marks(page)).every((mark) => ['mail-6', 'mail-4'].includes(mark.row))
  ).toBe(true);
});

test('no part of a Mail row draws the tap highlight', async ({ page }) => {
  const surface = page.locator(
    '[role="row"][id="mail-2"] [data-press-surface]'
  );
  // The row's long-press element is the context menu's touch owner.
  const owner = surface.locator('xpath=ancestor::*[@data-long-press][1]');
  await expect(owner).toHaveCount(1);
  const colors = await surface.evaluate((element) => {
    const out: string[] = [];
    // Up to the long-press element that holds the row.
    for (let node: Element | null = element; node; node = node.parentElement) {
      out.push(
        getComputedStyle(node).getPropertyValue('-webkit-tap-highlight-color')
      );
      if (node.hasAttribute('data-long-press')) break;
    }
    return out;
  });
  expect(colors.length).toBeGreaterThan(3);
  expect(new Set(colors)).toEqual(new Set(['rgba(0, 0, 0, 0)']));
});
