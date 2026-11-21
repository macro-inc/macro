// A reminder that comes due, on the local stack: the thread returns to the
// inbox and to Home, and the notification service announces it.

import type { Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { focusRow, rowIds } from './harness/list';
import { followup, makeFollowupDue, tickReminders } from './harness/organise';
import { anInbox, PROVIDERS } from './harness/providers';
import { confirmed, did, saw } from './ledger/record';

/** The user's notifications, as the notification service lists them. */
async function notifications(mailbox: Mailbox): Promise<string[]> {
  const answer = await mailbox.api('/notification/user_notifications');
  expect(answer.status).toBe(200);
  const body = (await answer.json()) as {
    items: { notification_event_type?: string; entity_id?: string }[];
  };
  return body.items.map(
    (each) => `${each.notification_event_type} ${each.entity_id}`
  );
}

/** The ids of the threads the email service lists in the inbox. */
async function inboxThreads(mailbox: Mailbox): Promise<string[]> {
  const answer = await mailbox.api(
    '/email/email/threads/previews/cursor/inbox?limit=100'
  );
  expect(answer.status).toBe(200);
  const body = (await answer.json()) as { items: { id: string }[] };
  return body.items.map((item) => item.id);
}

/** The row of a thread on Home. */
function homeRow(page: Page, threadId: string) {
  return page
    .getByRole('grid', { name: 'Home' })
    .locator(`[data-soup-entity][id*="${threadId}"]`);
}

for (const provider of PROVIDERS) {
  test.describe(`a reminder comes due, with ${anInbox(provider)}`, {
    tag: '@full-stack',
  }, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a thread set aside with Remind me never comes back:
    // it stays out of the inbox and of Home when its time has come, or it
    // comes back without the notification that says so.
    test('a due reminder returns the thread to Home and the inbox, and notifies', async ({
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
      await page.keyboard.press('h');
      did('AL-071');
      const when = page.getByRole('combobox', { name: 'Remind me when' });
      await when.fill('tomorrow 9am');
      await expect(
        page.getByRole('option', { name: /^tomorrow 9am/ })
      ).toBeVisible();
      await when.press('Enter');
      did('AL-621');
      await expect(when).toBeHidden();
      await expect.poll(() => rowIds(page)).not.toContain(thread.id);
      await expect
        .poll(async () => (await followup(mailbox, thread.id))?.state)
        .toBe('pending');
      expect(await inboxThreads(mailbox)).not.toContain(thread.id);

      // The thread waits out of Home too, which lists the rest.
      await mailbox.open('/app/home');
      await expect(
        page.getByRole('grid', { name: 'Home' }).getByRole('row').nth(1)
      ).toBeVisible();
      await expect(homeRow(page, thread.id)).toBeHidden();

      // Tomorrow comes: the reminder is due, and the scheduler's tick, which
      // the test plays, has the storage service deliver it.
      await makeFollowupDue(mailbox, thread.id);
      await expect
        .poll(
          async () => {
            await tickReminders(mailbox);
            return (await followup(mailbox, thread.id))?.state;
          },
          { timeout: 60_000 }
        )
        .toBe('returned');
      await expect.poll(() => inboxThreads(mailbox)).toContain(thread.id);
      await expect
        .poll(() => notifications(mailbox))
        .toContain(`reminder ${thread.id}`);
      confirmed('F-093');

      // Home was open all along: the thread is back without a reload.
      await expect(homeRow(page, thread.id)).toContainText('Lunch?');
      await expect(homeRow(page, thread.id).getByLabel('Unread')).toBeVisible();
      saw('STX-312');

      await mailbox.open();
      await expect.poll(() => rowIds(page)).toContain(thread.id);
    });
  });
}
