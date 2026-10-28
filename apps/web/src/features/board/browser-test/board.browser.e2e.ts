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

test('a modal closed before it animates in lets go of the board', async ({
  page,
}) => {
  await openBoard(page);
  // Open and close in one task, before the browser paints the modal.
  await card(page, 'general').evaluate((node) => {
    if (node instanceof HTMLElement) node.click();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
  });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.scrim-glass')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveCSS('pointer-events', 'none');
});

test('a line on a person card opens its conversation and gets focus back', async ({
  page,
}) => {
  await openBoard(page, 'v1e');
  const line = page.getByRole('button', { name: /bring the speakers/ });
  await line.click();
  await expect(page.getByRole('dialog')).toContainText(
    'Office is open late Friday'
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(line).toBeFocused();
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

test('Escape cancels a drag, and letting go does not open the card', async ({
  page,
}) => {
  await openBoard(page);
  const before = await restingBox(card(page, 'general'));
  if (!before) throw new Error('general is not on the board');
  const press = { x: before.x + 60, y: before.y + 20 };
  await page.mouse.move(press.x, press.y);
  await page.mouse.down();
  await page.mouse.move(press.x + 120, press.y + 60, { steps: 6 });
  await page.keyboard.press('Escape');
  // Still holding the button; wait past the next task, then let go.
  await page.waitForTimeout(100);
  await page.mouse.up();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const after = await restingBox(card(page, 'general'));
  expect(Math.round((after?.x ?? 0) - before.x)).toBe(0);
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

test('read items fade, leave after a quiet day, and can be shown again', async ({
  page,
}) => {
  await openBoard(page);
  const node = (name: string) =>
    page.locator('[data-board-node]').filter({
      has: page.locator(`[role="button"][aria-label^="${name}"]`),
    });
  // `ideas` was read hours ago; `general` still has unread messages.
  await expect(node('ideas')).toHaveCSS('opacity', '0.55');
  await expect(node('general')).toHaveCSS('opacity', '1');
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

test('zooms with the toolbar and a WebKit pinch, and fits the board again', async ({
  page,
}) => {
  await openBoard(page);
  const level = page.getByLabel('Zoom level');
  const fitted = await level.textContent();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(level).not.toHaveText(fitted ?? '');
  await page.getByRole('button', { name: 'Zoom to fit' }).click();
  await expect(level).toHaveText(fitted ?? '');
  // Safari reports trackpad pinches as gesture events, not ctrl+wheel.
  await page
    .locator('section[aria-roledescription="board"]')
    .evaluate((board) => {
      const gesture = (type: string, scale: number) =>
        Object.assign(new Event(type, { cancelable: true }), {
          scale,
          clientX: 700,
          clientY: 450,
        });
      board.dispatchEvent(gesture('gesturestart', 1));
      board.dispatchEvent(gesture('gesturechange', 1.5));
    });
  await expect(level).not.toHaveText(fitted ?? '');
});
