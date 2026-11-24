import {
  type CDPSession,
  expect,
  type Locator,
  type Page,
  test,
} from '@playwright/test';

/**
 * The touch list rows of Chat (a conversation and a pinned favorite), Home,
 * Soup lists, the Notifications inbox, Agents (sidebar and phone list),
 * Projects and Search show the same
 * pressed grey while pressed, through the app's one row press (rowPress.ts),
 * and drop it after the finger lifts or once the press turns into a scroll.
 */

const ROWS = [
  'chat',
  'pin',
  'home',
  'list',
  'notification',
  'agent',
  'agent-phone',
  'project',
  'search',
];
const SCREENSHOTS = process.env.ROW_PRESS_SCREENSHOT_DIR;

type Point = { x: number; y: number };

/** Spots inside the row that only its backgrounds paint, edges included. */
async function spotsIn(page: Page, row: string): Promise<Point[]> {
  const box = await page.getByTestId(row).boundingBox();
  if (!box) throw new Error(`${row} is not rendered`);
  if (row === 'pin') {
    // The tile's padding above and below the pin.
    return [
      { x: box.x + box.width / 2, y: box.y + box.height - 2 },
      { x: box.x + box.width / 2, y: box.y + 1 },
    ];
  }
  // Agents and Soup list rows hold their time at the end, and phone Agents
  // and Projects rows their controls, so look between title and end.
  const middle = ['agent', 'list', 'agent-phone', 'project'].includes(row);
  const x = middle ? box.x + box.width / 2 : box.x + box.width - 14;
  return [
    { x, y: box.y + box.height / 2 },
    { x, y: box.y + 1 },
  ];
}

/**
 * How light the screen is at a point, as the eye sees it: the mean channel
 * value of the pixels there. Gradients dither, so pixels can differ by one.
 */
async function shadeAt(page: Page, point: Point) {
  const png = await page.screenshot({
    clip: { x: point.x - 1, y: point.y - 1, width: 2, height: 2 },
    animations: 'disabled',
    caret: 'hide',
  });
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No 2D canvas');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    let sum = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      sum += pixels[index] + pixels[index + 1] + pixels[index + 2];
    }
    return sum / ((pixels.length / 4) * 3);
  }, png.toString('base64'));
}

/** How far a point's shade is from the press grey. */
const offGrey = async (page: Page, point: Point, grey: number) =>
  Math.abs((await shadeAt(page, point)) - grey);

/** The press grey over the panel: the hover tint twice over. */
async function pressedSwatch(page: Page) {
  await page.evaluate(() => {
    const swatch = document.createElement('div');
    swatch.id = 'swatch';
    swatch.style.cssText =
      'position:fixed;left:0;top:0;width:8px;height:8px;z-index:2147483647;' +
      'background-color:var(--color-panel);background-image:' +
      'linear-gradient(var(--color-hover),var(--color-hover)),' +
      'linear-gradient(var(--color-hover),var(--color-hover))';
    document.body.append(swatch);
  });
  const swatch = await shadeAt(page, { x: 4, y: 4 });
  await page.evaluate(() => document.getElementById('swatch')?.remove());
  return swatch;
}

const touch = (
  cdp: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd',
  point?: Point
) =>
  cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: point ? [point] : [],
  });

const opened = (page: Page): Locator => page.locator('main');

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
    const grey = await pressedSwatch(page);
    const spots = await spotsIn(page, row);
    for (const spot of spots) {
      expect(await offGrey(page, spot, grey)).toBeGreaterThan(5);
    }

    await touch(cdp, 'touchStart', spots[0]);
    // The whole row, edges included, shows the one grey.
    for (const spot of spots) {
      await expect.poll(() => offGrey(page, spot, grey)).toBeLessThan(1);
    }
    if (SCREENSHOTS) {
      await page.screenshot({
        path: `${SCREENSHOTS}/${test.info().project.name}-${row}-pressed.png`,
      });
    }

    await touch(cdp, 'touchEnd');
    await expect(opened(page)).toHaveAttribute('data-opened', row);
    // The grey holds for 350ms after release.
    expect(await offGrey(page, spots[0], grey)).toBeLessThan(1);
    await expect.poll(() => offGrey(page, spots[0], grey)).toBeGreaterThan(5);
  });
}

for (const row of ['chat', 'notification']) {
  test(`${row}: a quick tap shows the grey once it opens the row, then lets it go`, async ({
    page,
  }) => {
    const grey = await pressedSwatch(page);
    const [spot] = await spotsIn(page, row);

    await page.touchscreen.tap(spot.x, spot.y);
    await expect(opened(page)).toHaveAttribute('data-opened', row);
    // The grey holds for 350ms after the tap's click.
    expect(await offGrey(page, spot, grey)).toBeLessThan(1);
    await expect.poll(() => offGrey(page, spot, grey)).toBeGreaterThan(5);
  });
}

test('a press that turns into a scroll never shows the grey', async ({
  page,
}) => {
  const cdp = await page.context().newCDPSession(page);
  const [spot] = await spotsIn(page, 'chat');

  // Watch every change of the row for the pressed class.
  await page.evaluate(() => {
    const surface = document.querySelector(
      '[data-testid="chat"] [data-press-surface]'
    );
    if (!surface) throw new Error('The chat row has no press surface');
    new MutationObserver(() => {
      if (surface.classList.contains('touch-highlight')) {
        document.body.dataset.flashed = 'true';
      }
    }).observe(surface, { attributes: true });
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
    .poll(() => opened(page).evaluate((main) => main.scrollTop))
    .toBeGreaterThan(0);
  await page.waitForTimeout(400);
  await expect(page.locator('body')).not.toHaveAttribute('data-flashed');
  await expect(opened(page)).toHaveAttribute('data-opened', '');
});

test('a long press that opens the row menu drops the grey', async ({
  page,
}) => {
  test.skip(
    test.info().project.name === 'tablet',
    'Tablets open the desktop context menu, which keeps the grey until 350ms after the lift'
  );
  const cdp = await page.context().newCDPSession(page);
  const grey = await pressedSwatch(page);
  const [spot] = await spotsIn(page, 'project-menu');

  await touch(cdp, 'touchStart', spot);
  await expect.poll(() => offGrey(page, spot, grey)).toBeLessThan(1);
  await expect(opened(page)).toHaveAttribute('data-opened', 'project-menu');
  // Still held, and already clear.
  expect(await offGrey(page, spot, grey)).toBeGreaterThan(5);
  await touch(cdp, 'touchEnd');
  await page.waitForTimeout(400);
  expect(await offGrey(page, spot, grey)).toBeGreaterThan(5);
});

test('a held press that starts scrolling drops the grey', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  const grey = await pressedSwatch(page);
  const [spot] = await spotsIn(page, 'home');

  await touch(cdp, 'touchStart', spot);
  await expect.poll(() => offGrey(page, spot, grey)).toBeLessThan(1);
  for (let step = 1; step <= 6; step += 1) {
    await touch(cdp, 'touchMove', { x: spot.x, y: spot.y - step * 10 });
  }
  const [moved] = await spotsIn(page, 'home');
  await expect.poll(() => offGrey(page, moved, grey)).toBeGreaterThan(5);
  await touch(cdp, 'touchEnd');
  await expect(opened(page)).toHaveAttribute('data-opened', '');
});

/**
 * The tap-highlight color of every element from a long-pressable row's
 * owner (its long-press element or soup row container) down to its press
 * surface. iOS flashes WebKit's own highlight over that owner on later taps.
 */
const ownerHighlightColors = (scope: Locator) =>
  scope.evaluate((root) =>
    [...root.querySelectorAll('[data-press-surface]')].flatMap((surface) => {
      let owner: Element | undefined;
      for (
        let node: Element | null = surface;
        node;
        node = node.parentElement
      ) {
        if (node.matches('[data-long-press], [data-soup-entity]')) owner = node;
        if (node === root) break;
      }
      const colors: string[] = [];
      for (
        let node: Element | null = surface;
        node;
        node = node.parentElement
      ) {
        colors.push(
          getComputedStyle(node).getPropertyValue('-webkit-tap-highlight-color')
        );
        if (node === owner || node === root) break;
      }
      return colors;
    })
  );

test('no part of a long-pressable row draws the tap highlight', async ({
  page,
}) => {
  for (const row of ['home', 'list', 'agent-phone', 'project-menu']) {
    const colors = await ownerHighlightColors(page.getByTestId(row));
    expect(colors.length, row).toBeGreaterThan(1);
    expect(new Set(colors), row).toEqual(new Set(['rgba(0, 0, 0, 0)']));
  }
});
