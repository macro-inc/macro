import type { Page } from '@playwright/test';
import type { Mailbox } from './harness/fixtures';
import { expect, test } from './harness/linking';
import { anInbox, PROVIDERS } from './harness/providers';
import { did, saw } from './ledger/record';

/**
 * Answers the notification service's type preferences, which the stack does
 * not run, and keeps what the app turns off and on.
 */
function notificationPreferences(mailbox: Mailbox, disabled: string[]) {
  const disabledTypes = new Set(disabled);
  mailbox.front.stub(({ method, path }) => {
    if (path === '/notification/user_notifications/preferences') {
      return { json: { disabled_types: [...disabledTypes] } };
    }
    const change = path.match(
      /^\/notification\/user_notifications\/preferences\/([^/]+)\/(disable|enable)$/
    );
    if (!change || method === 'GET') return undefined;
    if (change[2] === 'disable') disabledTypes.add(change[1]);
    else disabledTypes.delete(change[1]);
    return { json: {} };
  });
  return disabledTypes;
}

/** The "New email" switch in Settings, Notifications. */
function newEmailSwitch(page: Page) {
  return page
    .locator('[data-settings-target]')
    .filter({ hasText: 'When a new email arrives' })
    .getByRole('switch');
}

/**
 * Flips the "New email" switch the way a pointer does: the switch's input is
 * visually hidden under its track, so the click goes to the track.
 */
async function setNewEmail(page: Page, on: boolean) {
  const toggle = newEmailSwitch(page);
  await expect(toggle).toBeChecked({ checked: !on });
  await toggle.locator('xpath=following-sibling::div[1]').click();
  did('AX-063');
  await expect(toggle).toBeChecked({ checked: on });
  saw('STX-943');
}

for (const provider of PROVIDERS) {
  test.describe(`the mail badge in the navigation rail, with ${anInbox(provider)}`, () => {
    test.use({ provider });

    // Class notify-badge-ignores-preference: with "New email" notifications
    // turned off, unread mail must not light the Mail badge. When this fails
    // the badge stays lit for someone who asked not to be told about new mail.
    test('unread mail lights the Mail badge only while new-email notifications are on', async ({
      page,
      mailbox,
    }) => {
      const disabledTypes = notificationPreferences(mailbox, ['new_email']);
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject: 'Lunch?',
        text: 'Noon at the usual place?',
      });
      await mailbox.synced('Lunch?');

      await mailbox.open('/app/mail/~/settings/notifications');
      const badge = page.locator('[data-sidebar-next-item="mail"]');
      const toggle = newEmailSwitch(page);
      await expect(toggle).toBeEnabled();
      await expect(toggle).not.toBeChecked();

      // Turning the type on shows the unread mail was there to be counted.
      await setNewEmail(page, true);
      await expect(badge).toHaveAttribute('data-unread');
      saw('STX-032');
      expect([...disabledTypes]).toEqual([]);

      await setNewEmail(page, false);
      await expect(badge).not.toHaveAttribute('data-unread');
      saw('STX-032');
      expect([...disabledTypes]).toEqual(['new_email']);

      // The saved preference, read again on a fresh load, still holds the
      // badge off; the mail list showing the unread thread is the later event.
      await mailbox.open('/app/mail/~/settings/notifications');
      await expect(newEmailSwitch(page)).toBeEnabled();
      await expect(newEmailSwitch(page)).not.toBeChecked();
      saw('STX-943');
      await expect(page.getByText('Lunch?').first()).toBeVisible();
      await expect(badge).not.toHaveAttribute('data-unread');
    });
  });
}
