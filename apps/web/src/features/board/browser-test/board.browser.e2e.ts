import { expect, type Locator, type Page, test } from '@playwright/test';

const fixture = '/src/features/board/browser-test/index.html';

async function openBoard(page: Page, variant = 'v1a') {
  await page.routeWebSocket(/^wss?:\/\/(?!localhost)/, (socket) =>
    socket.close()
  );
  await page.route('https://**', (route) => route.abort());
  await page.goto(`${fixture}#${variant}`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-board-node]').first()).toBeVisible();
}

const card = (page: Page, name: string) =>
  page.locator(`[data-board-node] [role="button"][aria-label^="${name}"]`);

/** Where a node rests once its entrance and layout motion have finished. */
async function restingBox(node: Locator) {
  let previous = '';
  await expect
    .poll(
      async () => {
        const box = JSON.stringify(await node.boundingBox());
        const resting = box === previous;
        previous = box;
        return resting;
      },
      { intervals: [150] }
    )
    .toBe(true);
  return node.boundingBox();
}

test('every variant draws the board and can be picked from the sidebar', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openBoard(page);
  const nav = page.getByRole('navigation', { name: 'Board variants' });
  for (const name of ['Bubbles', 'River', 'Radar', 'People', 'Neighborhoods']) {
    await nav.getByRole('button', { name: new RegExp(`^${name}`) }).click();
    await expect(
      page.getByRole('heading', { name, exact: true })
    ).toBeVisible();
    await expect(page.locator('[data-board-node]').first()).toBeVisible();
  }
  // The header's next arrow is named after the variant it goes to.
  await page.getByRole('button', { name: 'Bubbles', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Bubbles', exact: true })
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('opens a conversation in a modal and returns focus to it', async ({
  page,
}) => {
  await openBoard(page);
  await card(page, 'general').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Office is open late Friday');
  // Usually before the modal's opening animation has started.
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(card(page, 'general')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Fixture events')).toContainText(
    'opened channel:general'
  );
});

test('moves a card by hand, remembers it, and tidies it back', async ({
  page,
}) => {
  await openBoard(page);
  const before = await restingBox(card(page, 'general'));
  if (!before) throw new Error('general is not on the board');
  // Pressed on the card's header, and carried 500 by 300 pixels.
  const press = { x: before.x + 60, y: before.y + 20 };
  await page.mouse.move(press.x, press.y);
  await page.mouse.down();
  await page.mouse.move(press.x + 200, press.y + 140, { steps: 8 });
  await page.mouse.move(press.x + 500, press.y + 300, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const dropped = await restingBox(card(page, 'general'));
  expect(Math.round((dropped?.x ?? 0) - before.x)).toBe(500);
  expect(Math.round((dropped?.y ?? 0) - before.y)).toBe(300);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(card(page, 'general')).toBeVisible();
  await expect
    .poll(async () => (await card(page, 'general').boundingBox())?.x)
    .toBeCloseTo(dropped?.x ?? 0, 0);

  await page.getByRole('button', { name: 'Tidy up' }).click();
  await expect
    .poll(async () => (await card(page, 'general').boundingBox())?.x)
    .toBeCloseTo(before.x, 0);
  await expect(page.getByRole('button', { name: 'Tidy up' })).toBeDisabled();
});

test('a closed card stays away until something new happens in it', async ({
  page,
}) => {
  await openBoard(page);
  await card(page, 'design').hover();
  await page.getByRole('button', { name: 'Remove design from board' }).click();
  await expect(card(page, 'design')).toHaveCount(0);
  // The fixture's first new message lands in #design.
  await page.getByRole('button', { name: 'New message' }).click();
  await expect(card(page, 'design')).toHaveAttribute(
    'aria-label',
    'design, 2 unread'
  );
});

test('read items leave after a quiet day and can be shown again', async ({
  page,
}) => {
  await openBoard(page);
  const nodes = page.locator('[data-board-node]');
  const total = await nodes.count();
  for (let step = 0; step < 8; step++) {
    await page.getByRole('button', { name: '+3 hours' }).click();
  }
  await expect.poll(() => nodes.count()).toBeLessThan(total);
  const unread = await nodes.count();
  await page.getByRole('button', { name: /Show settled items/ }).click();
  await expect.poll(() => nodes.count()).toBeGreaterThan(unread);
});

test('zooms with the toolbar and fits the whole board again', async ({
  page,
}) => {
  await openBoard(page);
  const level = page.getByLabel('Zoom level');
  const fitted = await level.textContent();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(level).not.toHaveText(fitted ?? '');
  await page.getByRole('button', { name: 'Zoom to fit' }).click();
  await expect(level).toHaveText(fitted ?? '');
});
