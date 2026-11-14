// New mail as the notification service tells it, on the local stack: the
// open list shows a message that arrives without a reload, the Notifications
// inbox lists it and opens its thread, and the "New email" switch in Settings
// is kept by the service.

import type { Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { focusRow } from './harness/list';
import { anInbox, PROVIDERS } from './harness/providers';
import { notice } from './harness/send';
import { confirmed, did, saw } from './ledger/record';

type UserNotification = {
  notification_event_type?: string;
  entity_id?: string;
};

/** The user's notifications, as the notification service lists them. */
async function notifications(mailbox: Mailbox): Promise<UserNotification[]> {
  const answer = await mailbox.api('/notification/user_notifications');
  expect(answer.status).toBe(200);
  const body = (await answer.json()) as { items: UserNotification[] };
  return body.items;
}

/** The notification types the user turned off, as the service keeps them. */
async function disabledTypes(mailbox: Mailbox): Promise<string[]> {
  const answer = await mailbox.api(
    '/notification/user_notifications/preferences'
  );
  expect(answer.status).toBe(200);
  const body = (await answer.json()) as { disabled_types: string[] };
  return body.disabled_types;
}

/** The ids of what the user muted, as the notification service keeps them. */
async function muted(mailbox: Mailbox): Promise<string[]> {
  const answer = await mailbox.api('/notification/unsubscribe');
  expect(answer.status).toBe(200);
  const body = await answer.json();
  return (body as { item_id: string }[]).map((each) => each.item_id);
}

/**
 * Whether the app has finished reading the account's items in pages: it
 * keeps a checkpoint per kind of item, and the last kind it reads is done.
 */
async function backfilled(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const checkpoints = Object.keys(localStorage)
      .filter((key) => key.startsWith('graphql-soup-backfill:'))
      .map((key) => {
        const saved = JSON.parse(localStorage.getItem(key) ?? '{}') as {
          completed?: boolean;
        };
        return { key, completed: saved.completed === true };
      });
    return (
      checkpoints.some((each) => each.key.endsWith(':auxiliary-entities')) &&
      checkpoints.every((each) => each.completed)
    );
  });
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
  test.describe(`new mail is announced, with ${anInbox(provider)}`, {
    tag: '@full-stack',
  }, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, mail that arrives while the list is open shows only
    // after a reload: the live update from the services no longer reaches
    // the list.
    test('a message that arrives shows in the open list without a reload', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject: 'Lunch?',
        text: 'Noon at the quarry?',
      });
      await mailbox.synced('Lunch?');
      await mailbox.open();
      const list = page.getByRole('grid', { name: 'Email' });
      await expect(list.getByText('Lunch?')).toBeVisible();
      // The app reads the account's items in pages for a while after it
      // loads, and a page read after the mail arrived would bring it in: the
      // mail is sent once that reading is finished, so only the live update
      // can show it.
      await expect.poll(() => backfilled(page), { timeout: 90_000 }).toBe(true);

      await mailbox.deliver({
        from: 'Linus <linus@example.com>',
        subject: 'Dinner instead',
        text: 'Seven at the pier.',
      });
      await expect(list.getByText('Dinner instead')).toBeVisible({
        timeout: 60_000,
      });
      saw('STL-900');
      await expect(list.getByRole('row').nth(0)).toContainText(
        'Dinner instead'
      );
    });

    // When this fails, new mail is not announced in the Notifications inbox,
    // or the announcement does not lead to its thread.
    test('new mail is a notification that opens its thread', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject: 'Lunch?',
        text: 'Noon at the quarry?',
      });
      const thread = await mailbox.synced('Lunch?');
      await expect
        .poll(async () =>
          (await notifications(mailbox)).map(
            (each) => `${each.notification_event_type} ${each.entity_id}`
          )
        )
        .toContain(`new_email ${thread.id}`);
      confirmed('F-161');

      await mailbox.open('/app/notifications');
      const row = page
        .getByRole('grid', { name: 'Notifications' })
        .getByRole('row')
        .filter({ hasText: 'Lunch?' });
      await expect(row).toContainText('Grace');
      await expect(row).toContainText('Noon at the quarry?');
      await expect(row.getByRole('img', { name: 'Email' })).toBeVisible();
      saw('STX-313');

      await row.click();
      did('AX-058');
      await expect(
        page.getByRole('heading', { name: 'Lunch?' }).first()
      ).toBeVisible();
      await expect(page.getByText('Noon at the quarry?').last()).toBeVisible();
      saw('STX-944');
    });

    // When this fails, turning "New email" notifications off or on in
    // Settings is not kept by the notification service: the switch falls
    // back on the next load, and mail keeps (or stops) notifying.
    test('the "New email" switch is kept by the notification service', async ({
      page,
      mailbox,
    }) => {
      await mailbox.open('/app/mail/~/settings/notifications');
      await expect(newEmailSwitch(page)).toBeEnabled();

      await setNewEmail(page, false);
      await expect.poll(() => disabledTypes(mailbox)).toContain('new_email');
      confirmed('F-162');
      await mailbox.open('/app/mail/~/settings/notifications');
      await expect(newEmailSwitch(page)).toBeEnabled();
      await expect(newEmailSwitch(page)).not.toBeChecked();
      saw('STX-943');

      await setNewEmail(page, true);
      await expect
        .poll(() => disabledTypes(mailbox))
        .not.toContain('new_email');
      confirmed('F-162');
    });

    // When this fails, muting a thread from the list does not reach the
    // notification service, or unmuting does not undo it: a muted thread
    // keeps notifying, or a thread stays silent for good.
    test('a thread is muted and unmuted from the list', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject: 'Lunch?',
        text: 'Noon at the quarry?',
      });
      const thread = await mailbox.synced('Lunch?');
      await mailbox.open();
      await focusRow(page, thread.id);

      await page.keyboard.press('Shift+KeyM');
      did('AL-070');
      await expect(notice(page, 'Muted notifications')).toBeVisible();
      saw('STL-049');
      await expect.poll(() => muted(mailbox)).toContain(thread.id);
      confirmed('F-079');

      await focusRow(page, thread.id);
      await page.keyboard.press('Shift+KeyM');
      did('AL-070');
      await expect(notice(page, 'Unmuted notifications')).toBeVisible();
      saw('STL-049');
      await expect.poll(() => muted(mailbox)).not.toContain(thread.id);
      confirmed('F-079');
    });
  });
}
