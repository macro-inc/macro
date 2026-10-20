import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { USER_ID } from '../native/fixtures/mail';
import { expect, test } from './fixtures/meta-messaging';

test.use({
  baseURL: `http://127.0.0.1:${Number(process.env.FUNCTIONAL_APP_PORT ?? Number(process.env.FUNCTIONAL_TEST_PORT ?? 4191) + 1)}`,
  viewport: { width: 1440, height: 1000 },
  serviceWorkers: 'block',
});
test('ordinary channels and metadata recovery', async ({
  page,
  messaging: f,
}, testInfo) => {
  test.setTimeout(300_000);
  const { open, channels, unreadReply, metaRequests } = f;
  await test.step('missing sidebar metadata fails closed and retries', async () => {
    f.state.omitSidebar = true;
    f.state.metadataError = true;
    await open(channels[0].id);
    await expect(
      page.getByText('Conversation unavailable.', { exact: false })
    ).toBeVisible();
    await expect(
      page.locator('[data-input-id^="channel-input-"] [contenteditable="true"]')
    ).toHaveCount(0);
    assert.equal(metaRequests.length, 0);
    f.state.metadataError = false;
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(
      page
        .locator('[data-input-id^="channel-input-"] [contenteditable="true"]')
        .first()
    ).toBeVisible();
    await page.getByText('Participants', { exact: true }).first().click();
    await expect(page.getByText('Team access', { exact: true })).toBeVisible();
    assert.equal(metaRequests.length, 0);
    f.state.omitSidebar = false;
  });
  await test.step('ordinary channels and unread navigation', async () => {
    await open(channels[0].id);
    await expect(
      page.locator('[data-header-action][aria-label="Call"]')
    ).toBeVisible();
    await expect(page.getByText('Calls', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Conversation ready', { exact: false })
    ).toBeVisible();
    const nativeInput = page
      .locator(
        `[data-input-id="channel-input-${channels[0].id}"] [contenteditable="true"]`
      )
      .first();
    await expect(nativeInput).toBeVisible();
    await page
      .getByRole('button', { name: /unread notification.*above/ })
      .click();
    await expect(
      page.locator(`[data-message-id="${unreadReply.id}"]`)
    ).toBeInViewport();
    await nativeInput.fill('Native browser reply');
    await page
      .locator(
        `[data-input-id="channel-input-${channels[0].id}"] [data-input-action="send"]`
      )
      .click();
    await page
      .locator('[data-channel-scroll]')
      .evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
    await expect(
      page
        .locator('[data-channel-message-list]')
        .getByText('Native browser reply', { exact: true })
    ).toHaveCount(1);
  });
  await test.step('ordinary participants and rename make zero messaging requests', async () => {
    await page.getByText('Participants', { exact: true }).first().click();
    await expect(
      page.getByText('WhatsApp participants', { exact: true })
    ).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Channel actions', exact: true })
      .click();
    await page.getByRole('menuitem', { name: /^Rename(?:\s|$)/ }).click();
    await page
      .getByRole('textbox', { name: 'Name', exact: true })
      .fill('Renamed native conversation');
    await page.getByRole('button', { name: 'Save name', exact: true }).click();
    await expect(page.getByText('Rename item', { exact: true })).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Create channel', exact: true })
      .click();
    await expect(
      page.getByText('Create a WhatsApp Business group', { exact: true })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    assert.deepEqual(
      metaRequests,
      [],
      'ordinary channel open/participants/rename must not request /meta/*'
    );
    const networkLog = testInfo.outputPath('ordinary-channel-network.json');
    writeFileSync(networkLog, JSON.stringify(metaRequests));
    await testInfo.attach('ordinary-channel-network.json', {
      path: networkLog,
      contentType: 'application/json',
    });
  });
});

test('external composition, recovery and provider revisions', async ({
  page,
  messaging: f,
}, testInfo) => {
  test.setTimeout(300_000);
  const {
    open,
    channels,
    input,
    expectNoCustomerCalls,
    sends,
    messages,
    event,
    picker,
    sendButton,
    submissions,
  } = f;
  await test.step('external replies and native row reconciliation', async () => {
    await open(`${channels[1].id}?join_call=true&open_call_tab=true`);
    await expectNoCustomerCalls();
    const externalBadge = page
      .locator('[data-channel-message-list]')
      .getByText('External', { exact: true })
      .first();
    await expect(externalBadge).toBeVisible();
    const badgeBounds = await externalBadge.boundingBox();
    assert.ok(
      badgeBounds && badgeBounds.width > 20 && badgeBounds.height > 10,
      'external attribution must be readable by sighted users'
    );
    await expect(
      page.locator('[data-input-id^="channel-input-"] [contenteditable="true"]')
    ).toHaveCount(0);
    await input.fill('External browser reply');
    await page.getByRole('button', { name: 'Send reply via WhatsApp' }).click();
    await expect(
      page
        .locator('[data-channel-message-list]')
        .getByText('External browser reply', { exact: true })
    ).toHaveCount(1);
    await expect
      .poll(() => sends.get(channels[1].id)?.[0]?.state)
      .toBe('accepted');
    await expect(
      page.locator(
        `[data-message-id="${sends.get(channels[1].id)![0].message_id}"]`
      )
    ).toBeVisible();
    await expect(
      page
        .locator('[data-channel-message-list]')
        .getByText('External browser reply', { exact: true })
    ).toHaveCount(1);
  });
  await test.step('draft isolation and provider revisions', async () => {
    await input.fill('Saved WhatsApp draft');
    await open(channels[2].id);
    await expect(input).toHaveValue('');
    await page
      .getByRole('button', { name: 'Instagram conversation details' })
      .click();
    await expect(
      page.getByText('@test.customer', { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText('Test Customer', { exact: true }).last()
    ).toBeVisible();
    await page.keyboard.press('Escape');
    const revised = messages.get(channels[2].id)!.at(-1)!;
    revised.content = 'Edited customer message';
    revised.edited_at = new Date().toISOString();
    event(revised, 'edited');
    await expect(
      page.locator(`[data-message-id="${revised.id}"]`)
    ).toContainText('Edited customer message');
    revised.content = '';
    revised.deleted_at = new Date().toISOString();
    event(revised, 'message_deleted');
    messages.set(
      channels[2].id,
      messages
        .get(channels[2].id)!
        .filter((message) => message.id !== revised.id)
    );
    await expect(page.locator(`[data-message-id="${revised.id}"]`)).toHaveCount(
      0
    );
    await input.fill('Saved Instagram draft');
    await open(channels[1].id);
    await expect(input).toHaveValue('Saved WhatsApp draft');
    await page.reload({ waitUntil: 'commit' });
    await expect(input).toHaveValue('Saved WhatsApp draft');
    f.state.activeUser = 'macro|second-browser-user@example.com';
    await page.reload({ waitUntil: 'commit' });
    await expect(input).toHaveValue('');
    await input.fill('Second user draft');
    f.state.activeUser = USER_ID;
    await page.reload({ waitUntil: 'commit' });
    await expect(input).toHaveValue('Saved WhatsApp draft');
  });
  await test.step('binding failures and send permissions', async () => {
    f.state.holdBinding = true;
    await page.reload({ waitUntil: 'commit' });
    await expect(
      page.getByLabel('Loading conversation', { exact: true })
    ).toBeVisible();
    await expect(input).toHaveCount(0);
    await expectNoCustomerCalls();
    f.state.holdBinding = false;
    f.state.bindingError = true;
    await page.reload({ waitUntil: 'commit' });
    await expect(
      page.getByText('Conversation unavailable.', { exact: false })
    ).toBeVisible();
    await expect(input).toHaveCount(0);
    await expectNoCustomerCalls();
    f.state.bindingError = false;
    f.state.denied = true;
    await page.reload({ waitUntil: 'commit' });
    await expect(input).toHaveValue('Saved WhatsApp draft');
    await expect(
      page.getByRole('button', { name: 'Send reply via WhatsApp' })
    ).toBeDisabled();
    f.state.denied = false;
    await page.reload({ waitUntil: 'commit' });
  });
  await test.step('uncertain send recovery', async () => {
    await input.fill('Uncertain browser reply');
    f.state.unknownSend = true;
    await page.getByRole('button', { name: 'Send reply via WhatsApp' }).click();
    await page
      .getByRole('button', { name: 'Review reply', exact: true })
      .click();
    await expect(page.getByRole('checkbox')).not.toBeChecked();
    await expect(
      page.getByRole('button', { name: 'Send reply via WhatsApp' })
    ).toBeDisabled();
    await page
      .getByText(/I checked WhatsApp and want to send this again/)
      .click();
    await expect(
      page.getByRole('button', { name: 'Send reply via WhatsApp' })
    ).toBeEnabled();
    await page.reload({ waitUntil: 'commit' });
    await expect(page.getByRole('checkbox')).not.toBeChecked();
    f.state.unknownSend = false;
  });
  await test.step('template visibility and draft recovery', async () => {
    // Templates stay out of normal replies and appear only when required.
    f.state.activeUser = 'macro|template-browser-user@example.com';
    await page.reload({ waitUntil: 'commit' });
    await expect(input).toHaveValue('');
    await expect(page.getByRole('combobox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /template/i })).toHaveCount(
      0
    );
    await expect(page.getByText(/template/i)).toHaveCount(0);
    await page
      .getByRole('button', { name: 'WhatsApp conversation details' })
      .click();
    await expect(page.getByText('WhatsApp messages sent from')).toBeVisible();
    await expect(
      page.getByText('+1 202 555 0147', { exact: true })
    ).toBeVisible();
    await expect(page.getByText(/test account/i)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.screenshot({
      path: testInfo.outputPath('macro-messaging-browser-normal.png'),
    });

    f.state.windowClosed = true;
    await page.reload({ waitUntil: 'commit' });
    await input.fill('Typed before the window closed');
    await expect(sendButton).toBeDisabled();
    await expect(page.getByRole('combobox')).toHaveCount(0);
    await expect(page.getByText('The reply window is closed.')).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('macro-messaging-browser-closed.png'),
    });
    await page.getByRole('button', { name: 'Choose template' }).click();
    await picker.click();
    await page.getByRole('option', { name: 'order_update' }).click();
    await page.getByLabel('body 1').fill('Avery');
    await page.reload({ waitUntil: 'commit' });
    await expect(picker).toContainText('order_update');
    await expect(page.getByLabel('body 1')).toHaveValue('Avery');
    await page.screenshot({
      path: testInfo.outputPath('macro-messaging-browser-template.png'),
    });
    await page.getByRole('button', { name: 'Back to text reply' }).click();
    await expect(input).toHaveValue('Typed before the window closed');
    await page.getByRole('button', { name: 'Choose template' }).click();
    await expect(picker).toContainText('order_update');
    f.state.failSend = true;
    await sendButton.click();
    await expect(input).toHaveValue('Typed before the window closed');
    assert.deepEqual(submissions.at(-1)?.message, {
      type: 'template',
      template_id: 'approved-template',
      language: 'en_US',
      parameters: ['Avery'],
    });
    f.state.failSend = false;
    await input.fill('');
    await page.getByRole('button', { name: 'Edit and retry' }).last().click();
    await expect(picker).toContainText('order_update');
    await expect(page.getByLabel('body 1')).toHaveValue('Avery');
    await expect(sendButton).toBeEnabled();
    f.state.windowClosed = false;
    await page.reload({ waitUntil: 'commit' });
    await expect(picker).toContainText('order_update');
    await page.getByRole('button', { name: 'Back to text reply' }).click();
    await expect(page.getByRole('combobox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /template/i })).toHaveCount(
      0
    );
  });
  await test.step('expired intent recovery', async () => {
    f.state.activeUser = 'macro|expiry-browser-user@example.com';
    await page.reload({ waitUntil: 'commit' });
    await expect(input).toHaveValue('');
    await input.fill('Expired reply kept for editing');
    f.state.expireSend = true;
    await sendButton.click();
    const expiredIntent = submissions.at(-1)!;
    const expiredId = sends.get(channels[1].id)!.at(-1)!.id;
    const expiredRow = page.locator(`[data-external-send-id="${expiredId}"]`);
    await expect(
      expiredRow.getByRole('status', { name: 'Not sent', exact: true })
    ).toBeVisible();
    await expiredRow.getByRole('button', { name: 'Edit and retry' }).click();
    await expect(input).toHaveValue('Expired reply kept for editing');
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    f.state.expireSend = false;
    await sendButton.click();
    assert.notEqual(
      submissions.at(-1)!.idempotency_key,
      expiredIntent.idempotency_key
    );
    await expectNoCustomerCalls();
    f.state.activeUser = USER_ID;
    await page.screenshot({
      path: testInfo.outputPath('macro-messaging-browser.png'),
      fullPage: true,
    });
  });
});

test('account registration and mobile composition', async ({
  page,
  context,
  messaging: f,
}, testInfo) => {
  test.setTimeout(300_000);
  const {
    origin,
    settingsAccount,
    otherAccount,
    registrations,
    open,
    channels,
    input,
  } = f;
  await test.step('member settings and registration recovery', async () => {
    f.state.showSettings = true;
    await test.step('unregistered accounts do not produce an empty connected-account label', async () => {
      await open(channels[0].id);
      await page
        .getByRole('button', { name: 'Create channel', exact: true })
        .click();
      await page
        .getByText('Create a WhatsApp Business group', { exact: true })
        .click();
      await expect(
        page.getByText(
          'Connect an eligible WhatsApp Platform account in Settings to create a group.'
        )
      ).toBeVisible();
      await expect(page.getByText(/^Connected account:/)).toHaveCount(0);
      await page.keyboard.press('Escape');
    });

    await page.goto(`${origin}/app/settings/connections`, {
      waitUntil: 'commit',
    });
    const manage = page.getByRole('button', {
      name: 'Manage WhatsApp Business',
      exact: true,
    });
    await expect(manage).toBeEnabled();
    await manage.click();
    await expect(
      page.getByRole('button', {
        name: 'Connect Platform number',
        exact: true,
      })
    ).toBeVisible();
    const mine = page.locator(
      `[data-messaging-account="${settingsAccount.id}"]`
    );
    const other = page.locator(`[data-messaging-account="${otherAccount.id}"]`);
    await expect(
      mine.getByText(settingsAccount.display_name, { exact: true })
    ).toBeVisible();
    await expect(
      other.getByRole('button', { name: 'More', exact: true })
    ).toHaveCount(0);
    const pin = mine.getByLabel('WhatsApp two-step verification PIN');
    await pin.fill('123456');
    await mine
      .getByRole('button', { name: 'Register number', exact: true })
      .click();
    await expect(
      mine.getByRole('button', { name: 'Check registration', exact: true })
    ).toBeVisible();
    assert.equal(registrations[0]?.pin, '123456');
    assert.equal(
      await page.evaluate(() =>
        Object.values(localStorage).some((value) =>
          String(value).includes('123456')
        )
      ),
      false
    );
    await mine
      .getByRole('button', { name: 'Check registration', exact: true })
      .click();
    await expect(mine.getByText('Connected', { exact: true })).toBeVisible();
    assert.equal(registrations[1]?.pin, undefined);
    await mine.getByRole('button', { name: 'More', exact: true }).click();
    await page
      .getByRole('menuitem', { name: 'Disconnect', exact: true })
      .click();
    await expect(
      page.getByText('Disconnect Controlled Platform account?', {
        exact: true,
      })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  });
  await test.step('mobile controls and composition', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    // Switch the same isolated Chromium context to touch for the mobile stage.
    const touch = await context.newCDPSession(page);
    await touch.send('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: 1,
    });
    // Changing the shell to touch closes desktop overlays; open Settings in the mobile shell.
    await page.goto(`${origin}/app/settings/connections`, {
      waitUntil: 'commit',
    });
    await page
      .getByRole('button', { name: 'Manage WhatsApp Business', exact: true })
      .click();
    await expect(
      page.getByText('Controlled Platform account', { exact: true })
    ).toBeInViewport({ ratio: 1 });
    await expect(
      page.getByRole('button', {
        name: 'Connect Platform number',
        exact: true,
      })
    ).toBeInViewport({ ratio: 1 });
    await page.screenshot({
      path: testInfo.outputPath('settings-mobile.png'),
      animations: 'disabled',
      fullPage: true,
    });
    await page.keyboard.press('Escape');
    await open(channels[1].id);
    const provider = page.getByRole('button', {
      name: 'WhatsApp conversation details',
    });
    const box = await provider.boundingBox();
    assert.ok(box && box.width >= 44 && box.height >= 44);
    await provider.click();
    await expect(page.getByText('WhatsApp messages sent from')).toBeVisible();
    await page.keyboard.press('Escape');
    await input.fill('Mobile layout controlled draft');
    await page.screenshot({
      path: testInfo.outputPath('composer-mobile.png'),
      fullPage: true,
    });
  });
});

test('WhatsApp group creation and desktop/mobile management', async ({
  page,
  context,
  messaging: f,
}, testInfo) => {
  test.setTimeout(300_000);
  const {
    open,
    channels,
    input,
    settingsAccount,
    id,
    message,
    messages,
    event,
  } = f;
  f.state.showSettings = true;
  f.state.omitSidebar = true;
  settingsAccount.status = 'connected';
  settingsAccount.registration_status = 'registered';
  settingsAccount.health_error = null;
  await test.step('create a private WhatsApp group, bind, reply, and manage participants', async () => {
    await open(channels[0].id);
    await page
      .getByRole('button', { name: 'Create channel', exact: true })
      .click();
    await page
      .getByLabel('Name', { exact: true })
      .fill('Browser WhatsApp project');
    await page
      .getByText('Create a WhatsApp Business group', { exact: true })
      .click();
    await expect(
      page.getByText('Connected account: Controlled Platform account')
    ).toBeVisible();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(
      page.getByText('Private WhatsApp group', { exact: false })
    ).toBeVisible();
    // Group-only settings must not overwrite the ordinary creation choices.
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page
      .getByText('Create a WhatsApp Business group', { exact: true })
      .click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('radio', { name: /Team/ })).toBeChecked();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page
      .getByText('Create a WhatsApp Business group', { exact: true })
      .click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('group setup');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.getByLabel('Name', { exact: true })).toBeDisabled();
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue(
      'Browser WhatsApp project'
    );
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(
      page.getByText('Waiting for WhatsApp to confirm this group…')
    ).toBeVisible();
    assert.equal(f.state.groupCreateCalls, 1);
    assert.ok(f.state.group);
    f.state.group.setup = null;
    f.state.group.status = 'active';
    f.state.group.can_copy_link = true;
    f.state.group.can_remove = true;
    f.state.group.participants = [
      {
        external_sender_id: id(950),
        customer_id: 'US.GROUP',
        display_name: 'Group Customer',
        username: 'group.customer',
      },
    ];
    const incoming = message(
      f.state.groupChannelId,
      9200,
      'Ready for our group discussion',
      true
    );
    messages.get(f.state.groupChannelId)!.push(incoming);
    event(incoming);
    await expect(input).toBeVisible();
    await input.fill('Reply from the Macro team');
    await page
      .getByRole('button', { name: 'Send reply via WhatsApp', exact: true })
      .click();
    await expect(
      page
        .locator('[data-channel-message-list]')
        .getByText('Reply from the Macro team', { exact: true })
    ).toBeVisible();
    await page.getByText('Participants', { exact: true }).first().click();
    await expect(
      page.getByText('Macro teammates', { exact: true })
    ).toBeInViewport({ ratio: 1 });
    await expect(
      page.getByText('WhatsApp participants', { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText('Group Customer', { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText('Convert to team channel', { exact: false })
    ).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Channel actions', exact: true })
      .click();
    await expect(
      page.getByRole('menuitem', { name: /^Rename(?:\s|$)/ })
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page
      .getByRole('button', { name: 'Delete WhatsApp group', exact: true })
      .click();
    await expect(
      page.getByText('Delete WhatsApp group for everyone?', { exact: true })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(f.state.groupDeleteCalls, 0);
    await page
      .getByRole('button', { name: 'Remove', exact: true })
      .last()
      .click();
    await expect(
      page.getByText(
        'This person will be removed from the WhatsApp group and cannot rejoin through its invite link.'
      )
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Remove participant', exact: true })
      .click();
    await expect(page.getByRole('alert').last()).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(
      page.getByText('Group Customer', { exact: true })
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('whatsapp-group-desktop.png'),
      fullPage: true,
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const touch = await context.newCDPSession(page);
  await touch.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 1,
  });
  await test.step('mobile group participants and confirmed removal/deletion', async () => {
    await open(f.state.groupChannelId);
    await expect(
      page.getByText('Browser WhatsApp project', { exact: true }).first()
    ).toBeVisible();
    // The persisted Participants tab is shared by desktop and the mobile views menu.
    if (
      !(await page
        .getByText('WhatsApp participants', { exact: true })
        .isVisible())
    ) {
      await page
        .getByText('Browser WhatsApp project', { exact: true })
        .first()
        .click();
      await page
        .getByRole('radio', { name: 'Participants', exact: true })
        .click();
    }
    await page
      .getByRole('radiogroup', { name: 'Channel participants', exact: true })
      .getByText('WhatsApp', { exact: true })
      .click();
    await expect(
      page.getByText('WhatsApp participants', { exact: true })
    ).toBeInViewport();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page
      .getByRole('button', { name: 'Copy WhatsApp invite link', exact: true })
      .click();
    await expect(
      page.getByText('Invite link copied', { exact: true })
    ).toBeVisible();
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      'https://chat.whatsapp.com/fixture'
    );
    await expect(
      page.getByText('Group Customer', { exact: true })
    ).toBeVisible();
    const scrollingAncestors = await page
      .getByText('Group Customer', { exact: true })
      .evaluate((element) => {
        let count = 0;
        for (
          let parent = element.parentElement;
          parent;
          parent = parent.parentElement
        )
          if (['auto', 'scroll'].includes(getComputedStyle(parent).overflowY))
            count++;
        return count;
      });
    assert.equal(
      scrollingAncestors,
      1,
      'mobile participants has one scrolling owner'
    );
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath('whatsapp-group-mobile.png'),
      fullPage: true,
    });
    await page
      .getByRole('button', { name: 'Remove', exact: true })
      .last()
      .click();
    await page
      .getByRole('button', { name: 'Remove participant', exact: true })
      .click();
    await expect(page.getByText('Group Customer', { exact: true })).toHaveCount(
      0
    );
    await page
      .getByRole('button', { name: 'Delete WhatsApp group', exact: true })
      .click();
    const deleted = page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        new URL(response.url()).pathname ===
          `/dss/meta/channels/${f.state.groupChannelId}/group`
    );
    await page
      .getByRole('button', { name: 'Delete group for everyone', exact: true })
      .click();
    await deleted;
    assert.equal(f.state.groupDeleteCalls, 1);
    await expect(
      page.getByText('WhatsApp participants', { exact: true })
    ).toHaveCount(0);
    await expect(page).not.toHaveURL(new RegExp(f.state.groupChannelId));
  });
});
