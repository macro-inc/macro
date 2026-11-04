import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('https://**', (route) => route.abort());
  await page.route('**/__macro_dev/**', (route) => route.abort());
  await page.goto('/src/features/crm/browser-test/board.html');
  await expect(
    page.locator('[data-kanban-card="00000000-0000-0000-0000-000000000011"]')
  ).toBeVisible({
    timeout: 30000,
  });
});

test('opens a company and edits readable fields without starting a drag', async ({
  page,
}) => {
  const card = page.locator(
    '[data-kanban-card="00000000-0000-0000-0000-000000000011"]'
  );
  await card
    .getByRole('button', { name: 'Company: Acme International Manufacturing' })
    .click();
  await expect(page.getByLabel('Opened record')).toHaveText(
    'Acme International Manufacturing'
  );
  await card.getByRole('button', { name: /^Next step:/ }).click();
  const editor = card.getByRole('textbox', { name: 'Edit Next step' });
  await editor.fill('Schedule the renewal review with the whole team.');
  await editor.press('Tab');
  await page.reload();
  await expect(card).toContainText(
    'Schedule the renewal review with the whole team.'
  );
});

test('moves a card across lanes and restores its position after a reload', async ({
  page,
}) => {
  const card = page.locator(
    '[data-kanban-card="00000000-0000-0000-0000-000000000011"]'
  );
  await card.hover();
  const grip = card.getByRole('button', { name: /^Drag / });
  const target = page.locator(
    '[data-kanban-card="00000000-0000-0000-0000-000000000013"]'
  );
  const from = await grip.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('Cards are not laid out');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 30, to.y + 5, { steps: 15 });
  await page.mouse.up();
  const lane = page.getByRole('region', {
    name: 'Demo scheduled lane',
    exact: true,
  });
  await expect(lane.locator('[data-kanban-card]')).toHaveCount(2);
  await expect(lane.locator('[data-kanban-card]').first()).toHaveAttribute(
    'data-kanban-card',
    '00000000-0000-0000-0000-000000000011'
  );
  await page.reload();
  await expect(lane.locator('[data-kanban-card]').first()).toHaveAttribute(
    'data-kanban-card',
    '00000000-0000-0000-0000-000000000011'
  );
});

test('a lane starts the host composer with its stage and no blank save', async ({
  page,
}) => {
  const lane = page.getByRole('region', {
    name: 'Demo scheduled lane',
    exact: true,
  });
  await lane.getByRole('button', { name: 'New record', exact: true }).click();
  await expect(page.getByLabel('New record stage')).toHaveText(
    'Demo scheduled'
  );
  await expect(page.locator('[data-kanban-card]')).toHaveCount(3);
  expect(
    await page.evaluate(() => sessionStorage.getItem('crm-board-rows'))
  ).toBeNull();
});

test('reorders within a lane and restores order after a reload', async ({
  page,
}) => {
  const lane = page.getByRole('region', { name: 'New lead lane', exact: true });
  const card = lane.locator('[data-kanban-card]').last();
  await card.hover();
  const from = await card.getByRole('button', { name: /^Drag / }).boundingBox();
  const to = await lane.locator('[data-kanban-card]').first().boundingBox();
  if (!from || !to) throw new Error('Cards are not laid out');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 30, to.y + 5, { steps: 15 });
  await page.mouse.up();
  await expect(lane.locator('[data-kanban-card]').first()).toContainText(
    'Borealis'
  );
  await page.reload();
  await expect(lane.locator('[data-kanban-card]').first()).toContainText(
    'Borealis'
  );
});

test('moves through the card menu on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const card = page.locator('[data-kanban-card]').first();
  await card.hover();
  await card.getByRole('button', { name: /^Move / }).click();
  await page.getByRole('menuitem', { name: 'Won', exact: true }).click();
  const lane = page.getByRole('region', { name: 'Won lane', exact: true });
  await expect(lane.locator('[data-kanban-card]')).toContainText(
    'Acme International Manufacturing'
  );
  await page.reload();
  await expect(lane.locator('[data-kanban-card]')).toContainText(
    'Acme International Manufacturing'
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390
  );
});

test.describe('touch scrolling', () => {
  test.use({
    isMobile: true,
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });

  test('swipes the lanes without dragging a card', async ({ page }) => {
    const card = page.locator('[data-kanban-card]').first();
    const grip = await card
      .getByRole('button', { name: /^Drag / })
      .boundingBox();
    expect(grip?.width).toBeGreaterThanOrEqual(44);
    expect(grip?.height).toBeGreaterThanOrEqual(44);
    const viewport = page.locator('[data-kanban-board-viewport]');
    const nextStep = await card
      .getByLabel('Next step', { exact: true })
      .boundingBox();
    if (!nextStep) throw new Error('Card field is not laid out');
    const y = nextStep.y + nextStep.height / 2;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: 300, y }],
    });
    for (let x = 280; x >= 60; x -= 20) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y }],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await expect
      .poll(() => viewport.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(100);
    await expect(page.locator('[data-kanban-preview]')).toHaveCount(0);
    await expect(
      page
        .getByRole('region', { name: 'New lead lane', exact: true })
        .locator('[data-kanban-card]')
    ).toHaveCount(2);
    expect(
      await page.evaluate(() => sessionStorage.getItem('crm-board-positions'))
    ).toBeNull();
    await cdp.detach();
  });
});

for (const settlement of ['success', 'refusal']) {
  test(`switches boards during a pending reorder before ${settlement}`, async ({
    page,
  }) => {
    await page.goto(
      `/src/features/crm/browser-test/board.html?switch=${settlement}`
    );
    const lane = page.getByRole('region', {
      name: 'New lead lane',
      exact: true,
    });
    const cards = lane.locator('[data-kanban-card]');
    await expect(cards).toHaveCount(2);
    const original = await cards.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-kanban-card'))
    );
    const moving = cards.last();
    await moving.hover();
    const from = await moving
      .getByRole('button', { name: /^Drag / })
      .boundingBox();
    const to = await cards.first().boundingBox();
    if (!from || !to) throw new Error('Cards are not laid out');
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 30, to.y + 5, { steps: 15 });
    await page.mouse.up();
    await expect(
      page.getByRole('button', { name: 'Finish move' })
    ).toBeEnabled();
    await expect(cards.first()).toHaveAttribute(
      'data-kanban-card',
      original[1]!
    );
    await page.getByRole('button', { name: 'Board B', exact: true }).click();
    await expect(cards.first()).toHaveAttribute(
      'data-kanban-card',
      original[0]!
    );
    await page.getByRole('button', { name: 'Finish move' }).click();
    await expect(
      page.getByRole('button', { name: 'Finish move' })
    ).toBeDisabled();
    await expect(cards.first()).toHaveAttribute(
      'data-kanban-card',
      original[0]!
    );
    await page.getByRole('button', { name: 'Board A', exact: true }).click();
    await expect(cards.first()).toHaveAttribute(
      'data-kanban-card',
      original[settlement === 'success' ? 1 : 0]!
    );
  });
}
