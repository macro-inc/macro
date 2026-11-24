import { type CDPSession, expect, type Page, test } from '@playwright/test';

async function center(page: Page, label: string) {
  const box = await page.getByRole('button', { name: label }).boundingBox();
  if (!box) throw new Error(`${label} is not rendered`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function touch(
  cdp: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd',
  point?: { x: number; y: number }
) {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: point ? [point] : [],
  });
}

const presses = (page: Page) => page.getByRole('status', { name: 'Presses' });
const lens = (page: Page) => page.locator('[data-dock-lens]');

test.beforeEach(async ({ page }) => {
  await page.goto('/dock-lens.html');
  await expect(page.getByRole('button', { name: 'Home' })).toBeVisible();
});

test('a drag carries the lens under the finger and presses the tab it ends on', async ({
  page,
}) => {
  const cdp = await page.context().newCDPSession(page);
  const home = await center(page, 'Home');
  const tasks = await center(page, 'Tasks');

  await touch(cdp, 'touchStart', home);
  await expect(lens(page)).toHaveAttribute('data-shown', '');
  for (let step = 1; step <= 12; step += 1)
    await touch(cdp, 'touchMove', {
      x: home.x + ((tasks.x - home.x) * step) / 12,
      y: home.y,
    });
  // The lens is scrolled content: it sits under the finger mid-drag, behind
  // only by the distance the finger moves before a touch becomes a scroll.
  const box = await lens(page).boundingBox();
  const lensCenter = (box?.x ?? 0) + (box?.width ?? 0) / 2;
  expect(Math.abs(lensCenter - tasks.x)).toBeLessThan(32);
  if (process.env.DOCK_LENS_SCREENSHOT)
    await page.screenshot({ path: process.env.DOCK_LENS_SCREENSHOT });
  // The buttons themselves have not moved.
  expect(await center(page, 'Tasks')).toEqual(tasks);
  await touch(cdp, 'touchEnd');

  await expect(presses(page)).toHaveText('Tasks');
  await expect(lens(page)).not.toHaveAttribute('data-shown');
  await expect(page.getByRole('button', { name: 'Tasks' })).not.toHaveClass(
    /text-ink-extra-muted/
  );
});

test('a tap presses its tab once', async ({ page }) => {
  await page.touchscreen.tap(
    ...(Object.values(await center(page, 'Chat')) as [number, number])
  );
  await expect(presses(page)).toHaveText('Chat');
  await expect(lens(page)).not.toHaveAttribute('data-shown');
  await page.waitForTimeout(400);
  await expect(presses(page)).toHaveText('Chat');
});
