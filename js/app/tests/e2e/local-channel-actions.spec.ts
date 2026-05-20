import { expect, type Locator, type Page, test } from '@playwright/test';

import { localE2ESeed } from './fixtures/local-e2e-seed';
import {
  fillEditable,
  gotoApp,
  LOCAL_E2E,
  uniqueE2EText,
} from './helpers/local-app';

test.skip(
  !LOCAL_E2E,
  'local channel action tests require LOCAL_E2E=true and seeded local data'
);

test.describe('local channel actions', () => {
  test.describe.configure({ timeout: 60_000 });

  test('sends a message and reacts in a seeded channel', async ({ page }) => {
    const channel = localE2ESeed.smoke.generalChannel;
    const channelId = channel.channel_id;
    const messageText = uniqueE2EText('local e2e channel message');

    await openSeededChannel(page, channelId);

    const message = await sendChannelMessage(page, channelId, messageText);

    await reactToMessage(message, '👍');
    await expect(
      message.locator('[data-message-reaction-chip][data-emoji="👍"]')
    ).toBeVisible({ timeout: 10_000 });
  });

  test('opens a reply composer for a seeded channel message', async ({
    page,
  }) => {
    const channel = localE2ESeed.smoke.generalChannel;
    const message = localE2ESeed.smoke.generalWelcomeMessage;

    await openSeededChannel(
      page,
      channel.channel_id,
      `?channel_message_id=${message.message_id}`
    );

    const messageRow = page.locator(
      `[data-message-id="${message.message_id}"]`
    );
    await expect(messageRow).toBeVisible({ timeout: 30_000 });

    await openReplyInput(messageRow);
    await expect(
      page.locator(`[data-inline-input-container-id="${message.message_id}"]`)
    ).toContainText('Send a reply', { timeout: 10_000 });
  });
});

async function openSeededChannel(
  page: Page,
  channelId: string,
  searchParams: string = ''
) {
  const channelName =
    localE2ESeed.smoke.generalChannel.channel_name ?? 'general';

  await gotoApp(page, `/channel/${channelId}${searchParams}`);
  await expect(
    page.getByText(channelName, { exact: true }).first()
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-channel-message-list]')).toBeVisible({
    timeout: 30_000,
  });
}

async function sendChannelMessage(
  page: Page,
  channelId: string,
  text: string
): Promise<Locator> {
  const input = page.locator(`[data-input-id="channel-input-${channelId}"]`);
  await fillEditable(input.locator('[contenteditable="true"]').first(), text);
  await clickSend(input);

  const message = messageByText(page, text);
  await expect(message).toBeVisible({ timeout: 30_000 });
  return message;
}

async function clickSend(input: Locator) {
  const sendButton = input.locator('[data-input-action="send"]');
  await expect(sendButton).toBeEnabled({ timeout: 10_000 });
  await sendButton.click();
}

async function reactToMessage(message: Locator, emoji: string) {
  await message.hover();
  const reaction = message.locator(
    `[data-message-action="react-quick"][data-emoji="${emoji}"]`
  );
  await expect(reaction).toBeVisible({ timeout: 10_000 });
  await reaction.click();
}

async function openReplyInput(message: Locator) {
  await message.hover();
  const reply = message.locator('[data-message-action="reply"]');
  await expect(reply).toBeVisible({ timeout: 10_000 });
  await reply.click();
}

function messageByText(page: Page, text: string) {
  return page.locator('[data-message]').filter({ hasText: text }).last();
}
