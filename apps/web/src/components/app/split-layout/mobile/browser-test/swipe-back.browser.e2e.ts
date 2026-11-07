import { expect, type Locator, type Page, test } from '@playwright/test';

async function point(target: Locator, xRatio: number) {
  const box = await target.boundingBox();
  if (!box) throw new Error('The swipe target is not rendered');
  return {
    x: box.x + box.width * xRatio,
    y: box.y + box.height / 2,
  };
}

/** One session so the browser treats the points as a single finger. */
async function swipe(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number }
) {
  const client = await page.context().newCDPSession(page);
  const move = (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    point?: { x: number; y: number }
  ) =>
    client.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: point ? [{ x: point.x, y: point.y }] : [],
    });
  await move('touchStart', from);
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await move('touchMove', {
      x: from.x + ((to.x - from.x) * i) / steps,
      y: from.y + ((to.y - from.y) * i) / steps,
    });
  }
  return async () => {
    await move('touchEnd');
    await client.detach();
  };
}

test('a rightward swipe in the message list goes back and leaves the message still', async ({
  page,
}) => {
  await page.goto('/');
  const message = page.getByTestId('message');
  await expect(message).toBeVisible();
  const from = await point(message, 0.35);
  const to = { x: Math.min(from.x + 260, 370), y: from.y };

  const release = await swipe(page, from, to);

  const channel = page.getByTestId('channel');
  await expect(channel).toHaveAttribute('style', /translateX\((?!0px)/);
  const messageShift = await message.evaluate((el) => {
    const content = el.closest<HTMLElement>('[data-swipe-content]');
    return content?.style.transform ?? '';
  });
  expect(messageShift).toBe('');
  await page.screenshot({
    path: test.info().outputPath('mid-swipe.png'),
  });

  await release();
  await expect(page.locator('[data-screen]')).toHaveAttribute(
    'data-screen',
    'list'
  );
  await expect(page.getByTestId('channel-list')).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('after-back.png'),
  });
});

test('the composer does not go back, and a left swipe replies', async ({
  page,
}) => {
  await page.goto('/');
  const composer = page.getByTestId('composer');
  const box = await composer.boundingBox();
  if (!box) throw new Error('The composer is not rendered');
  const from = { x: 80, y: box.y + box.height / 2 };
  await (await swipe(page, from, { x: 360, y: from.y }))();
  await expect(page.locator('[data-screen]')).toHaveAttribute(
    'data-screen',
    'channel'
  );

  const message = page.getByTestId('message');
  const start = await point(message, 0.8);
  await (await swipe(page, start, { x: start.x - 160, y: start.y }))();
  await expect(page.locator('[data-screen]')).toHaveAttribute(
    'data-reply',
    'yes'
  );
  await expect(page.locator('[data-screen]')).toHaveAttribute(
    'data-screen',
    'channel'
  );
});

test('a vertical drag scrolls the message list', async ({ page }) => {
  await page.goto('/');
  const messages = page.getByTestId('messages');
  const before = await messages.evaluate((el) => el.scrollTop);
  const from = await point(page.getByText('Note 2'), 0.5);
  await (await swipe(page, from, { x: from.x + 8, y: from.y - 180 }))();
  await expect
    .poll(() => messages.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(before);
  await expect(page.locator('[data-screen]')).toHaveAttribute(
    'data-screen',
    'channel'
  );
});
