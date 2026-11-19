// Sharing a thread with a person, on the local stack: the share goes through
// the app and the services that carry it, and the email service then answers
// the person the thread.

import type { Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import type { SignedInUser } from './harness/front';
import { askAs } from './harness/local-stack';
import { anInbox, PROVIDERS } from './harness/providers';
import { confirmed, did, saw } from './ledger/record';

/** The Share dialog of the open thread. */
async function openShare(page: Page) {
  await page
    .getByRole('group', { name: 'Sharing' })
    .getByRole('button', { name: 'Share', exact: true })
    .click();
  did('AL-131');
  const dialog = page.getByRole('dialog', { name: 'Share: Agenda' });
  await expect(
    dialog.getByText('People with access to this email thread')
  ).toBeVisible();
  return dialog;
}

/** A thread of the mailbox, open, shared with another person from the dialog. */
async function shared(page: Page, mailbox: Mailbox) {
  await mailbox.deliver({
    from: 'Grace <grace@example.com>',
    subject: 'Agenda',
    text: 'About Agenda.',
  });
  const agenda = await mailbox.synced('Agenda');
  const bob = await mailbox.stack.user(
    mailbox.stack.address('bob@example.com')
  );
  expect(await readStatus(bob, agenda.id)).toBe(401);

  await mailbox.open(`/app/mail/${agenda.id}`);
  await expect(page.getByText('About Agenda.')).toBeVisible();
  const dialog = await openShare(page);
  await expect(dialog.getByText('Owner', { exact: true })).toBeVisible();
  saw('STL-622');

  await dialog.getByRole('combobox', { name: 'To: Email or group' }).click();
  await page.keyboard.type(bob.email);
  await page.keyboard.press('Enter');
  const share = dialog.getByRole('button', { name: /^Share/ });
  await expect(share).toBeEnabled();
  await share.click();
  did('AL-195');
  await expect(dialog).toBeHidden();
  return { agenda, bob };
}

/** The status the email service answers the person who asks for the thread. */
async function readStatus(user: SignedInUser, threadId: string) {
  const answer = await askAs(user, `/email/email/threads/${threadId}?limit=1`);
  return answer.status;
}

for (const provider of PROVIDERS) {
  test.describe(`sharing a thread of ${anInbox(provider)} with a person`, {
    tag: '@full-stack',
  }, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a thread shared from the Share dialog does not reach
    // the person it was shared with: the email service still refuses them
    // the thread.
    test('the person can read the thread', async ({ page, mailbox }) => {
      const { agenda, bob } = await shared(page, mailbox);
      await expect
        .poll(() => readStatus(bob, agenda.id), { timeout: 30_000 })
        .toBe(200);
      confirmed('F-158');
    });

    test('the owner sees the person they shared with and can remove access', async ({
      page,
      mailbox,
    }) => {
      const { agenda, bob } = await shared(page, mailbox);
      await expect
        .poll(() => readStatus(bob, agenda.id), { timeout: 30_000 })
        .toBe(200);
      const dialog = await openShare(page);
      const recipient = dialog.getByText(/^bob$/i);
      await expect(recipient).toBeVisible();
      const recipientRoster = await askAs(
        bob,
        `/dss/threads/${agenda.id}/channel-shares`
      );
      expect(recipientRoster.status).toBe(401);
      await dialog
        .getByRole('button', { name: 'Can edit', exact: true })
        .last()
        .click();
      await page.getByRole('menuitemradio', { name: 'Remove Access' }).click();
      did('AL-619');
      await expect(recipient).toHaveCount(0);
      await expect
        .poll(() => readStatus(bob, agenda.id), { timeout: 30_000 })
        .toBe(401);
    });
  });
}
