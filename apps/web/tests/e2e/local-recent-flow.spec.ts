import { expect, type Locator, type Page, test } from '@playwright/test';

import {
  ENTITY_ID_DATA_ATTRIBUTE,
  soupListContainerSelector,
} from '../../src/lib/core/dom-selectors';
import { localE2ESeed } from './fixtures/local-e2e-seed';
import {
  expectEntityInCurrentList,
  fillEditable,
  gotoApp,
  LOCAL_E2E,
  uniqueE2EText,
} from './helpers/local-app';

test.skip(
  !LOCAL_E2E,
  'local recent/flow tests require LOCAL_E2E=true and seeded local data'
);

// The seed writes rows directly to Postgres, so seeded entities carry no
// activity — the touched set starts empty. Each test creates its own touch
// through the UI (a channel message → a `messaged` activity via the Kafka
// consumer) and then asserts against the feed it populates.
const CHANNEL = {
  id: localE2ESeed.smoke.generalChannel.channel_id,
  name: localE2ESeed.smoke.generalChannel.channel_name ?? 'general',
};

test.describe('recent and flow views', () => {
  test.describe.configure({ timeout: 120_000 });

  test('a touched channel leads the recent feed', async ({ page }) => {
    await openSeededChannel(page, CHANNEL.id);
    await sendChannelMessage(page, CHANNEL.id, uniqueE2EText('recent touch'));

    // The activity row lands via the Kafka consumer; navigating to the view
    // issues a fresh query, retried below until the consumer catches up.
    await expect(async () => {
      await gotoApp(page, '/component/recent');
      const firstRow = page
        .locator(`${soupListContainerSelector} [${ENTITY_ID_DATA_ATTRIBUTE}]`)
        .first();
      await expect(firstRow).toHaveAttribute(
        ENTITY_ID_DATA_ATTRIBUTE,
        CHANNEL.id,
        { timeout: 5_000 }
      );
    }).toPass({ timeout: 60_000 });
  });

  test('the sidebar surfaces flow and recent below inbox', async ({ page }) => {
    await gotoApp(page, '/component/inbox');

    const nav = page.getByRole('navigation');
    await expect(nav.getByRole('button', { name: 'Flow' })).toBeVisible();
    const recentLink = nav.getByRole('button', { name: 'Recent' });
    await expect(recentLink).toBeVisible();

    // The link opens the view through the split manager, which then writes
    // the canonical /component/recent URL.
    await recentLink.click();
    await expect(page).toHaveURL(/component\/recent/);
    await expect(page.locator(soupListContainerSelector).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test('flow shows the touched half merged into the feed', async ({ page }) => {
    await openSeededChannel(page, CHANNEL.id);
    await sendChannelMessage(page, CHANNEL.id, uniqueE2EText('flow touch'));

    // The channel carries no inbox notification for this user (their own
    // message), so its presence in flow proves the touched half of the merge.
    await expect(async () => {
      await gotoApp(page, '/component/flow');
      await expectEntityInCurrentList(page, CHANNEL.id, CHANNEL.name);
    }).toPass({ timeout: 60_000 });
  });
});

async function openSeededChannel(page: Page, channelId: string) {
  await gotoApp(page, `/channel/${channelId}`);
  await expect(
    page.getByText(CHANNEL.name, { exact: true }).first()
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-channel-message-list]')).toBeVisible({
    timeout: 30_000,
  });
}

async function sendChannelMessage(page: Page, channelId: string, text: string) {
  const input = page.locator(`[data-input-id="channel-input-${channelId}"]`);
  await fillEditable(input.locator('[contenteditable="true"]').first(), text);
  await clickSend(input);

  const message = messageByText(page, text);
  await expect(message).toBeVisible({ timeout: 30_000 });
}

async function clickSend(input: Locator) {
  const sendButton = input.locator('[data-input-action="send"]');
  await expect(sendButton).toBeEnabled({ timeout: 10_000 });
  await sendButton.click();
}

function messageByText(page: Page, text: string) {
  return page.locator('[data-message]').filter({ hasText: text }).last();
}
