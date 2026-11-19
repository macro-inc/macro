// New mail as the notification service tells it, on the local stack: the
// open list shows a message that arrives without a reload, the Notifications
// inbox lists it and opens its thread, the "New email" switch in Settings
// is kept by the service, and the Mail badge counts only mail that arrived
// while that switch was on.

import type { Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { focusRow } from './harness/list';
import { localStackAddresses } from './harness/local-stack';
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

/**
 * The queues a new mail's notification passes through: Gmail's sync hands it
 * on as it finishes the queue message that stored the thread, and the
 * notification service reads the user's types as it takes it off its own.
 */
const NOTIFYING_QUEUES = [
  'email-service-gmail-inbox-sync-queue',
  'email-service-gmail-inbox-retry-queue',
  'notification-ingress-queue',
];

/**
 * Whether the services have decided if a thread's new mail notifies, which
 * happens after the thread is listed. Outlook's sync hands the mail on from
 * its projection, whose outbox row for the thread goes when it is done; then
 * every queue on the way must be empty. The local stack's queues are shared,
 * so this also waits for other tests' mail.
 */
async function decided(mailbox: Mailbox, threadId: string): Promise<boolean> {
  const [outbox] = await mailbox.stack.sql<{ waiting: number }>(
    `SELECT count(*)::int AS waiting FROM email_projection_outbox
     WHERE link_id = '${mailbox.inbox.linkId}' AND payload->>'thread_id' = '${threadId}'`
  );
  if ((outbox?.waiting ?? 0) > 0) return false;
  for (const queue of NOTIFYING_QUEUES) {
    if (await queueBusy(queue)) return false;
  }
  return true;
}

/** Whether a queue of the local stack holds a message, waiting or taken. */
async function queueBusy(queue: string): Promise<boolean> {
  const sqs = localStackAddresses()?.sqsUrl;
  if (!sqs)
    throw new Error(
      "EMAIL_E2E_STACK_SQS_URL is not set: the address of the stack's LocalStack"
    );
  const answer = await fetch(`${sqs}/000000000000/${queue}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      Action: 'GetQueueAttributes',
      Version: '2012-11-05',
      'AttributeName.1': 'All',
    }),
  });
  const text = await answer.text();
  expect(answer.status, text).toBe(200);
  const counts = [
    ...text.matchAll(
      /<Name>ApproximateNumberOfMessages\w*<\/Name>\s*<Value>(\d+)<\/Value>/g
    ),
  ];
  expect(counts, text).toHaveLength(3);
  return counts.some(([, count]) => count !== '0');
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

    // Class notify-badge-ignores-preference: when this fails, mail that
    // arrives while "New email" notifications are off still lights the Mail
    // badge, so someone who asked not to be told about new mail is told.
    // The badge counts the Notifications inbox's unread mail rows, and the
    // service makes no row for a type the user turned off.
    test('the Mail badge counts only mail that arrives while new-email notifications are on', async ({
      page,
      mailbox,
    }) => {
      const badge = page.locator('[data-sidebar-next-item="mail"]');
      await mailbox.deliver({
        from: 'Linus <linus@example.com>',
        subject: 'Dinner instead',
        text: 'Seven at the pier.',
      });
      const announced = await mailbox.synced('Dinner instead');
      await expect
        .poll(async () =>
          (await notifications(mailbox)).map(
            (each) => `${each.notification_event_type} ${each.entity_id}`
          )
        )
        .toContain(`new_email ${announced.id}`);
      await mailbox.open('/app/mail/~/settings/notifications');
      await expect(badge).toHaveAttribute('data-unread');
      await expect(badge).toHaveAttribute('data-unread-count', '1');
      saw('STX-032');

      // The switch stays off from here on: the notification service reads it
      // when it takes the mail, after the mail is listed.
      await expect(newEmailSwitch(page)).toBeEnabled();
      await setNewEmail(page, false);
      await expect.poll(() => disabledTypes(mailbox)).toContain('new_email');
      confirmed('F-162');
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject: 'Lunch?',
        text: 'Noon at the quarry?',
      });
      const unannounced = await mailbox.synced('Lunch?');
      await expect
        .poll(() => decided(mailbox, unannounced.id), { timeout: 60_000 })
        .toBe(true);
      expect(
        (await notifications(mailbox)).map((each) => each.entity_id)
      ).not.toContain(unannounced.id);

      // Both threads are unread; only the one that arrived with the type on
      // is counted. A load reads the count afresh: the count stream starts
      // from the service's own count.
      await mailbox.open('/app/mail');
      await expect(badge).toHaveAttribute('data-unread-count', '1');
      saw('STX-032');
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
