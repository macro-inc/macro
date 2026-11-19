import { type CDPSession, expect, type Page, test } from '@playwright/test';

/**
 * The touch list rows of Chat (a conversation and a pinned favorite), Home,
 * the Notifications inbox, Agents and Search show the pressed grey while
 * pressed, through the app's one row press (rowPress.ts), and drop it after
 * the finger lifts or once the press turns into a scroll.
 */

const ROWS = ['chat', 'pin', 'home', 'notification', 'agent', 'search'];
const SCREENSHOTS = process.env.ROW_PRESS_SCREENSHOT_DIR;

type Point = { x: number; y: number };

/** A spot inside the row that only its own background paints. */
async function spotIn(page: Page, row: string): Promise<Point> {
  const box = await page.getByTestId(row).boundingBox();
  if (!box) throw new Error(`${row} is not rendered`);
  if (row === 'pin') {
    // The tile's bottom padding, under the pin's name.
    return { x: box.x + box.width / 2, y: box.y + box.height - 2 };
  }
  return { x: box.x + box.width - 14, y: box.y + box.height / 2 };
}

/**
 * The background the eye sees at a point: the nearest painted layer's color
 * and image, and how many layers under the point paint at all before the
 * panel (a second one would darken the grey).
 */
const paintAt = (page: Page, point: Point) =>
  page.evaluate(({ x, y }) => {
    const panel = getComputedStyle(
      document.querySelector('main')!
    ).backgroundColor;
    const painted = [];
    let element = document.elementFromPoint(x, y);
    while (element) {
      const style = getComputedStyle(element);
      const color = style.backgroundColor;
      if (color === panel) break;
      if (color !== 'rgba(0, 0, 0, 0)' || style.backgroundImage !== 'none') {
        painted.push(`${color} ${style.backgroundImage}`);
      }
      element = element.parentElement;
    }
    return painted.join(' | ') || 'panel';
  }, point);

/** The shared press grey: the hover tint twice over, on one element. */
const pressedPaint = (page: Page) =>
  page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.backgroundColor = 'var(--color-hover)';
    probe.style.backgroundImage =
      'linear-gradient(var(--color-hover), var(--color-hover))';
    document.body.append(probe);
    const style = getComputedStyle(probe);
    const paint = `${style.backgroundColor} ${style.backgroundImage}`;
    probe.remove();
    return paint;
  });

const touch = (
  cdp: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd',
  point?: Point
) =>
  cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: point ? [point] : [],
  });

test.beforeEach(async ({ page }) => {
  // The rows' context providers read channels from services; none answer.
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.protocol !== 'https:') {
      return route.continue();
    }
    return route.abort('blockedbyclient');
  });
  await page.goto('/row-press.html');
  await expect(page.getByTestId('search')).toBeVisible({ timeout: 60_000 });
  // The fixture lays out phones as phones: touch at the device's width.
  const width = await page.evaluate(() => window.innerWidth);
  expect(width).toBe(page.viewportSize()?.width);
  await expect(page.locator('html')).toHaveAttribute(
    'data-touch-device',
    'true'
  );
});

for (const row of ROWS) {
  test(`${row}: a held press shows the pressed grey until after release`, async ({
    page,
  }) => {
    const cdp = await page.context().newCDPSession(page);
    const grey = await pressedPaint(page);
    const spot = await spotIn(page, row);
    const resting = await paintAt(page, spot);
    expect(resting).not.toBe(grey);

    await touch(cdp, 'touchStart', spot);
    await expect.poll(() => paintAt(page, spot)).toBe(grey);
    if (SCREENSHOTS) {
      await page.screenshot({
        path: `${SCREENSHOTS}/${test.info().project.name}-${row}-pressed.png`,
      });
    }

    await touch(cdp, 'touchEnd');
    await expect(page.locator('main')).toHaveAttribute('data-opened', row);
    await expect.poll(() => paintAt(page, spot)).toBe(resting);
  });
}

test('a quick tap shows the grey once it opens the row, then lets it go', async ({
  page,
}) => {
  const grey = await pressedPaint(page);
  const spot = await spotIn(page, 'chat');
  const resting = await paintAt(page, spot);

  // Record the paint the moment the row's click runs, as the tap opens it.
  await page.evaluate(({ x, y }) => {
    document.addEventListener('click', () => {
      requestAnimationFrame(() => {
        let element = document.elementFromPoint(x, y);
        while (element) {
          const style = getComputedStyle(element);
          if (style.backgroundImage !== 'none') {
            document.body.dataset.paintOnTap = `${style.backgroundColor} ${style.backgroundImage}`;
            return;
          }
          element = element.parentElement;
        }
      });
    });
  }, spot);
  await page.touchscreen.tap(spot.x, spot.y);
  await expect(page.locator('main')).toHaveAttribute('data-opened', 'chat');
  await expect(page.locator('body')).toHaveAttribute('data-paint-on-tap', grey);
  await expect.poll(() => paintAt(page, spot)).toBe(resting);
});

test('a press that turns into a scroll never shows the grey', async ({
  page,
}) => {
  const cdp = await page.context().newCDPSession(page);
  const grey = await pressedPaint(page);
  const spot = await spotIn(page, 'chat');
  const row = page.getByTestId('chat').locator('[data-press-surface]');

  // Watch every frame of the gesture for the pressed class.
  await page.evaluate(() => {
    const surface = document.querySelector(
      '[data-testid="chat"] [data-press-surface]'
    );
    const record = () => {
      if (surface?.classList.contains('touch-highlight')) {
        document.body.dataset.flashed = 'true';
      }
    };
    new MutationObserver(record).observe(surface as Element, {
      attributes: true,
    });
  });

  await touch(cdp, 'touchStart', spot);
  // The finger rests for 40ms, then drags the list up.
  await page.waitForTimeout(40);
  for (let step = 1; step <= 12; step += 1) {
    await touch(cdp, 'touchMove', { x: spot.x, y: spot.y - step * 10 });
  }
  await page.waitForTimeout(200);
  await touch(cdp, 'touchEnd');

  await expect
    .poll(() => page.locator('main').evaluate((main) => main.scrollTop))
    .toBeGreaterThan(0);
  await page.waitForTimeout(400);
  await expect(page.locator('body')).not.toHaveAttribute('data-flashed');
  await expect(row).not.toHaveClass(/touch-highlight/);
  await expect(page.locator('main')).toHaveAttribute('data-opened', '');
  expect(await paintAt(page, await spotIn(page, 'chat'))).not.toBe(grey);
});

test('a held press that starts scrolling drops the grey', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  const grey = await pressedPaint(page);
  const spot = await spotIn(page, 'home');

  await touch(cdp, 'touchStart', spot);
  await expect.poll(() => paintAt(page, spot)).toBe(grey);
  for (let step = 1; step <= 6; step += 1) {
    await touch(cdp, 'touchMove', { x: spot.x, y: spot.y - step * 10 });
  }
  await expect
    .poll(async () => paintAt(page, await spotIn(page, 'home')))
    .not.toBe(grey);
  await touch(cdp, 'touchEnd');
  await expect(page.locator('main')).toHaveAttribute('data-opened', '');
});
