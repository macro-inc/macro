import { expect, type Locator, type Page, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).hostname === 'localhost')
      await route.continue();
    else await route.fulfill({ status: 401, body: '{}' });
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  await page.goto('/src/features/entity/browser-test/participants.html');
  await expect(
    page.getByTestId('list-narrow').getByText('Ada', { exact: true })
  ).toBeVisible({ timeout: 60_000 });
});

/** Rest on a target long enough for any hover card to open. */
async function dwell(page: Page, target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error('Target is not laid out');
  await page.mouse.move(box.x - 20, box.y - 20);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 10,
  });
  await page.waitForTimeout(600);
}

/** Hover a sender until its card shows; the first card on a cold page loads late. */
async function openCard(page: Page, sender: Locator, card: Locator) {
  await expect(async () => {
    await dwell(page, sender);
    await expect(card).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

async function click(page: Page, target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error('Target is not laid out');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 5,
  });
  await page.mouse.down();
  await page.mouse.up();
}

for (const list of ['list-narrow', 'list-wide']) {
  test(`${list}: hovering a sender shows the card; the row, not the card, opens the email`, async ({
    page,
  }) => {
    const sender = page
      .getByTestId(list)
      .getByText('macro-application[bot]')
      .first();
    const card = page.getByText('notifications@example.com');
    await openCard(page, sender, card);

    await click(page, card);
    await expect(page.getByLabel('Opened threads')).toHaveText('');

    // Pressing the sender closes its card; the click must still land.
    await click(page, sender);
    await expect(page.getByLabel('Opened threads')).toHaveText('thread-1');
  });
}

test('thread: hovering a collapsed sender shows the card; the message, not the card, opens', async ({
  page,
}) => {
  const thread = page.getByTestId('thread');
  const sender = thread.getByText('Ada', { exact: true });
  const card = page.getByText('sender1@example.com');
  await openCard(page, sender, card);

  await click(page, card);
  await expect(page.getByLabel('Expanded messages')).toHaveText('');

  await click(page, sender);
  await expect(page.getByLabel('Expanded messages')).toHaveText('message-1');
});

test.describe('touch', () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 900 },
  });

  test('tapping a sender opens the email', async ({ page }) => {
    await page
      .getByTestId('list-narrow')
      .getByText('Alan', { exact: true })
      .tap();
    await expect(page.getByLabel('Opened threads')).toHaveText('thread-2');
  });

  test("tapping a collapsed message's sender picture opens the message", async ({
    page,
  }) => {
    const avatar = page
      .getByTestId('thread')
      .locator('[data-slot="avatar"]')
      .nth(1);
    const box = await avatar.boundingBox();
    if (!box) throw new Error('Avatar is not laid out');
    // A finger lands on the picture whether or not the picture takes the tap.
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByLabel('Expanded messages')).toHaveText('message-2');
  });
});
