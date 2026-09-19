import { expect, type Page, test } from '@playwright/test';

import { localE2ESeed } from './fixtures/local-e2e-seed';
import {
  gotoApp,
  LOCAL_E2E,
  sendChannelMessage,
  uniqueE2EText,
} from './helpers/local-app';

test.skip(
  !LOCAL_E2E,
  'local channel edit tests require LOCAL_E2E=true and seeded local data'
);

test.describe('local channel message edit hotkeys', () => {
  test.describe.configure({ timeout: 60_000 });

  test('saving an edit with Enter does not open the reply input', async ({
    page,
  }) => {
    const messageId = await startInlineEditOfOwnMessage(
      page,
      uniqueE2EText('edit enter plain')
    );

    await page.keyboard.press('Enter');

    await expectEditSavedWithoutReplyInput(page, messageId);
  });

  test('saving an edit with a rolled-over Enter does not open the reply input', async ({
    page,
  }) => {
    const messageId = await startInlineEditOfOwnMessage(
      page,
      uniqueE2EText('edit enter rollover')
    );

    // Fast typing rolls keys over: Enter goes down before the last typed
    // letter is released, so the letter's keyup lands after the editor has
    // closed and focus has returned to the message list.
    await page.keyboard.down('d');
    await page.keyboard.down('Enter');
    await page.keyboard.up('d');
    await page.keyboard.up('Enter');

    await expectEditSavedWithoutReplyInput(page, messageId);
  });
});

/**
 * Sends a fresh message, selects it with the keyboard (ArrowUp from the empty
 * channel input), and opens the inline editor with the `e` hotkey. Returns
 * the message id.
 */
async function startInlineEditOfOwnMessage(
  page: Page,
  messageText: string
): Promise<string> {
  const channel = localE2ESeed.smoke.generalChannel;
  const channelId = channel.channel_id;

  await openSeededChannel(page, channelId);
  const message = await sendChannelMessage(page, channelId, messageText);
  const input = page.locator(`[data-input-id="channel-input-${channelId}"]`);
  await input.locator('[contenteditable="true"]').first().click();
  const messageId = await message.getAttribute('data-message-id');
  expect(messageId).toBeTruthy();

  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('e');

  const editor = page
    .locator(`[data-input-id="edit-message-input-${messageId}"]`)
    .locator('[contenteditable="true"]')
    .first();
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await expect(editor).toBeFocused({ timeout: 10_000 });

  return messageId as string;
}

async function expectEditSavedWithoutReplyInput(page: Page, messageId: string) {
  await expect(
    page.locator(`[data-input-id="edit-message-input-${messageId}"]`)
  ).toHaveCount(0, { timeout: 10_000 });

  // The straggler keyup (or a key repeat) fires synchronously after the
  // editor closes; give the reply input a beat to appear before asserting
  // that it did not.
  await page.waitForTimeout(500);
  await expect(
    page.locator(`[data-input-id="thread-reply-input-${messageId}"]`)
  ).toHaveCount(0);
}

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
