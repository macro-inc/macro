import { expect, type Page, test } from '@playwright/test';

import { localE2ESeed } from './fixtures/local-e2e-seed';
import {
  createDocument,
  gotoApp,
  LOCAL_E2E,
  openSidePanelSection,
  sendChannelMessage,
  uniqueE2EText,
} from './helpers/local-app';

const FEED_PAGE_LIMIT = 50;

test.skip(
  !LOCAL_E2E,
  'local activity tests require LOCAL_E2E=true and seeded local data'
);

test.describe('local activity', () => {
  test.describe.configure({ timeout: 60_000 });

  test('records a messaged row after a channel send', async ({ page }) => {
    const channel = localE2ESeed.smoke.generalChannel;
    const messageText = uniqueE2EText('local e2e activity message');

    await openSeededChannel(page, channel.channel_id);
    await sendChannelMessage(page, channel.channel_id, messageText);

    await gotoApp(page, '/component/activity');
    await expect(
      page
        .locator('[data-activity-row][data-activity-action="messaged"]')
        .first()
    ).toBeVisible({ timeout: 30_000 });
  });

  test('pages the seeded feed past the first cursor', async ({ page }) => {
    expect(localE2ESeed.activity.seededEventCount).toBeGreaterThan(
      FEED_PAGE_LIMIT
    );

    await gotoApp(page, '/component/activity');
    const rows = page.locator('[data-activity-row]');
    await expect(rows).toHaveCount(FEED_PAGE_LIMIT, { timeout: 30_000 });

    await page.getByRole('button', { name: 'Show more' }).click();
    await expect
      .poll(async () => rows.count(), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(localE2ESeed.activity.seededEventCount);
  });

  test('shows the created event for a new document in the side panel', async ({
    page,
  }) => {
    await gotoApp(page, '/component/activity');
    await createDocument(page);
    await openSidePanelSection(page, 'Activity');

    const created = page.locator(
      '[data-activity-row][data-activity-action="created"]'
    );
    await expect(created).toBeVisible({ timeout: 30_000 });
    await expect(created).toContainText('You');
  });
});

async function openSeededChannel(page: Page, channelId: string) {
  const channelName =
    localE2ESeed.smoke.generalChannel.channel_name ?? 'general';

  await gotoApp(page, `/channel/${channelId}`);
  await expect(
    page.getByText(channelName, { exact: true }).first()
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-channel-message-list]')).toBeVisible({
    timeout: 30_000,
  });
}
