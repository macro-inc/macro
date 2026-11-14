// A scheduled message the provider refuses when its time comes. In a Gmail
// inbox the composer says the send failed before delivery and restores it as
// a draft; in an Outlook inbox it says the provider rejected the send and
// sends it again.

import type { Page } from '@playwright/test';
import { composeNew, draftThreads, loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { addMailbox, readMailbox } from './harness/journeys';
import { injectFault, notice, sentMessages } from './harness/send';
import { confirmed, did, saw } from './ledger/record';

const GRACE = 'grace@example.com';
const REJECTED =
  'Your mail provider rejected this send. You can retry after correcting the problem in your mailbox.';

type Scheduled = { db_id: string; scheduled_send_time: string };

/** The messages Macro holds to send later. */
async function scheduled(mailbox: Mailbox): Promise<Scheduled[]> {
  const response = await mailbox.api(
    '/email/email/drafts/scheduled?offset=0&limit=100'
  );
  const body = (await response.json()) as { messages: Scheduled[] };
  return body.messages;
}

/** The subjects of what the mailbox has in Sent at the provider. */
async function sentSubjects(mailbox: Mailbox): Promise<string[]> {
  return (await sentMessages(mailbox)).map((message) => message.subject);
}

/**
 * Schedules a new message for tomorrow, lets its time come while the
 * provider refuses sends (`times` of them, or all), and opens it from the
 * Scheduled tab.
 */
async function openRefusedScheduledSend(
  page: Page,
  mailbox: Mailbox,
  times?: number
): Promise<void> {
  await addMailbox(mailbox, GRACE);
  await composeNew(page, mailbox, {
    to: GRACE,
    subject: 'Quarterly numbers',
    body: 'The numbers are in.',
  });
  await page.getByRole('button', { name: /^Choose send time/ }).click();
  await page.getByRole('combobox', { name: /./ }).last().fill('tomorrow 9am');
  await page.getByRole('option').first().click();
  did('AC-046');
  await page
    .getByRole('button', { name: 'Schedule send', exact: true })
    .click();
  did('AC-049');
  await expect(
    page.getByRole('status', { name: 'Email scheduled', exact: true })
  ).toBeVisible();
  saw('STC-059');
  await expect.poll(async () => (await scheduled(mailbox)).length).toBe(1);
  const [held] = await scheduled(mailbox);

  await injectFault(mailbox, {
    route: 'messages.send',
    error: 'forbidden',
    times,
  });
  const due = await mailbox.stack.sql(
    `UPDATE email_scheduled_messages SET send_time = now() - interval '1 second'
     WHERE message_id = '${held.db_id}' AND link_id = '${mailbox.inbox.linkId}'
     RETURNING message_id`
  );
  expect(due).toHaveLength(1);
  await mailbox.stack.runScheduledSweep();

  await page
    .getByRole('navigation', { name: 'Email tabs' })
    .getByRole('button', { name: 'Scheduled' })
    .click();
  did('AL-002', 'F-145');
  await page.getByRole('main').getByText('Quarterly numbers').click();
  did('AL-050');
}

/** Macro holds the message as a draft, not to send, and it was never sent. */
async function expectRestoredDraft(mailbox: Mailbox): Promise<void> {
  await expect.poll(() => scheduled(mailbox)).toEqual([]);
  await expect
    .poll(async () =>
      (await draftThreads(mailbox)).map((thread) => thread.name)
    )
    .toEqual(['Quarterly numbers']);
  expect(await sentSubjects(mailbox)).toEqual([]);
  expect(await readMailbox(mailbox, GRACE)).toEqual([]);
}

test.beforeEach(({ page }) => loadAppSteadily(page));

test.describe('a scheduled send that fails from a Gmail inbox', () => {
  test.use({ provider: 'GMAIL' });

  test('is reported as failed before delivery and restored as a draft', async ({
    page,
    mailbox,
  }) => {
    await openRefusedScheduledSend(page, mailbox);
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Send failed before delivery' })
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(
        'Cancel to restore this draft and review it before sending again.'
      )
    ).toBeVisible();
    saw('STC-057');
    await expect(
      page.getByRole('button', {
        name: 'Send time cannot be changed during delivery or recovery.',
      })
    ).toBeDisabled();
    saw('STC-051', 'F-147');

    // The Send button's tooltip covers the bar while the pointer rests on it.
    await page.mouse.move(0, 0);
    await page
      .getByRole('button', { name: 'Restore failed scheduled draft' })
      .click();
    did('AC-053');
    await expect(
      notice(page, 'Schedule cancelled. This email is editable again.')
    ).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Subject' })).toBeEnabled();
    await expect(
      page.getByRole('button', { name: /^Choose send time/ })
    ).toBeEnabled();

    await expectRestoredDraft(mailbox);
    confirmed('F-147');
  });
});

test.describe('a scheduled send that fails from an Outlook inbox', () => {
  test.use({ provider: 'OUTLOOK' });

  test('is reported as rejected by the provider and goes out when sent again', async ({
    page,
    mailbox,
  }) => {
    await openRefusedScheduledSend(page, mailbox, 1);
    await expect(notice(page, REJECTED)).toBeVisible({ timeout: 30_000 });
    saw('STC-982');
    // Macro holds it unsent: nothing reached the provider or Grace.
    expect(await sentSubjects(mailbox)).toEqual([]);
    expect(await readMailbox(mailbox, GRACE)).toEqual([]);

    const retry = page.getByRole('button', { name: 'Retry send' });
    await retry.click();
    did('AC-916');
    await expect(retry).toHaveCount(0);
    // The retry is due at once; the scheduler's sweep delivers it.
    await expect(async () => {
      await mailbox.stack.runScheduledSweep();
      expect(await sentSubjects(mailbox)).toEqual(['Quarterly numbers']);
    }).toPass({ timeout: 30_000 });
    await expect
      .poll(async () =>
        (await readMailbox(mailbox, GRACE)).map((message) => message.subject)
      )
      .toEqual(['Quarterly numbers']);
    await expect.poll(() => scheduled(mailbox)).toEqual([]);
    confirmed('F-147');
  });

  // The schedule is cancelled and the notice says the email is editable
  // again, but its composer stays locked behind the rejected send.
  test('known bug: outlook-cancelled-failed-schedule-stays-locked: a rejected scheduled send that is cancelled is an editable draft again', {
    tag: '@known-bug',
  }, async ({ page, mailbox }) => {
    await openRefusedScheduledSend(page, mailbox);
    await expect(notice(page, REJECTED)).toBeVisible({ timeout: 30_000 });
    saw('STC-982');

    await page.mouse.move(0, 0);
    await page.getByRole('button', { name: 'Cancel scheduled send' }).click();
    did('AC-915');
    await expect(
      notice(page, 'Schedule cancelled. This email is editable again.')
    ).toBeVisible();
    await expectRestoredDraft(mailbox);
    await expect(page.getByRole('textbox', { name: 'Subject' })).toBeEnabled();
    confirmed('F-147');
  });
});
