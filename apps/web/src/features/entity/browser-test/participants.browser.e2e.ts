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
    page.getByTestId('list-narrow').getByText('Ada Lovelace')
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

/** Move down to a target the way a pointer does, then click it. */
async function moveAndClick(page: Page, target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error('Target is not laid out');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 10,
  });
  await page.waitForTimeout(200);
  await page.mouse.down();
  await page.mouse.up();
}

for (const list of ['list-narrow', 'list-wide']) {
  test(`${list}: clicking the next row's sender opens that email`, async ({
    page,
  }) => {
    const rows = page.getByTestId(list);
    await dwell(page, rows.getByText('Ada Lovelace'));
    await moveAndClick(page, rows.getByText('Alan Turing'));
    await expect(page.getByLabel('Opened threads')).toHaveText('thread-2');
  });
}

test("thread: clicking the next collapsed message's sender opens that message", async ({
  page,
}) => {
  const thread = page.getByTestId('thread');
  await dwell(page, thread.getByText('Ada', { exact: true }));
  await moveAndClick(page, thread.getByText('Alan', { exact: true }));
  await expect(page.getByLabel('Expanded messages')).toHaveText('message-2');
});

test.describe('touch', () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 900 },
  });

  test('tapping a sender opens the email', async ({ page }) => {
    await page.getByTestId('list-narrow').getByText('Alan Turing').tap();
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
