// The sending inbox of a draft once the user has a second one: the From of a
// reply, and the Retry of a new email's inbox change that did not go through.

import type { Page } from '@playwright/test';
import {
  composeNew,
  loadAppSteadily,
  routeDraftId,
  watchDraftSaves,
} from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { readMailbox } from './harness/journeys';
import { replyEditor, threadMessages } from './harness/send';
import { backfilled } from './harness/states-send2';
import { sentCopy } from './harness/ways-compose1';
import { replyTo, send } from './harness/ways-compose2';
import { did } from './ledger/record';

const WORK = 'ada.work@example.com';

test.beforeEach(({ page }) => loadAppSteadily(page));

/** Opens the From menu of the composer on the screen and picks `email`. */
async function chooseFrom(page: Page, email: string): Promise<void> {
  await page.getByRole('button', { name: 'From address' }).click();
  const choices = page.getByRole('menuitem');
  await expect(choices).toHaveCount(2);
  await choices.filter({ hasText: email }).click();
}

for (const provider of ['GMAIL', 'OUTLOOK'] as const) {
  test.describe(`the sending inbox of a reply in ${provider === 'GMAIL' ? 'a Gmail' : 'an Outlook'} inbox`, () => {
    test.use({ provider });

    // When this fails, the From menu of a reply's open envelope does not
    // change the inbox it is sent from: the reply leaves the inbox the
    // thread is in, not the one chosen. From is chosen while an Outlook
    // reply may still be being written to Outlook (see
    // `compose-new.spec.ts`).
    test('a reply is sent from the inbox chosen in its From', async ({
      page,
      mailbox,
    }) => {
      const work = await mailbox.stack.link(mailbox.user, provider, WORK);
      const saves = watchDraftSaves(page);
      const subject = 'From the other inbox';
      const thread = await replyTo(page, mailbox, subject);
      await replyEditor(page).click();
      await page.keyboard.type('Answering from work.');
      await expect
        .poll(() => saves.some((save) => save.html.includes('from work')))
        .toBe(true);
      const drafts = async () =>
        (await threadMessages(mailbox, thread.id)).filter(
          (message) => message.is_draft
        );
      await expect
        .poll(async () => (await drafts()).length, {
          message: 'the reply was never stored',
        })
        .toBe(1);

      // The envelope opens from its summary of the recipients.
      await page.getByRole('button', { name: /^Replying to / }).click();
      const from = page.getByRole('button', { name: 'From address' });
      await expect(from).toContainText(mailbox.inbox.email);
      await chooseFrom(page, work.email);
      did('AC-079', 'F-100');
      await expect(from).toContainText(work.email);
      await send(page);

      const sent = await sentCopy(mailbox, `Re: ${subject}`, work.email);
      expect(sent.from).toBe(work.email);
      expect(sent.html).toContain('Answering from work.');
      expect(
        (await readMailbox(mailbox, mailbox.inbox.email)).filter(
          (message) =>
            message.subject === `Re: ${subject}` &&
            message.from === mailbox.inbox.email
        )
      ).toEqual([]);
    });
  });
}

// Gmail only: the refusal is the test's own, made before the request reaches
// the email service; the move itself is tested on both providers above and
// in compose-new.spec.ts.
// When this fails, the notice of an inbox change that did not go through
// offers no Retry, or its Retry does not move the new email: it is still
// sent from the inbox it was written in.
test('the Retry of an inbox change that did not go through sends the new email from the chosen inbox', async ({
  page,
  mailbox,
}) => {
  const work = await mailbox.stack.link(mailbox.user, 'GMAIL', WORK);
  // "Inbox synced", raised when an inbox's first backfill is announced,
  // stacks on the refused change's notice and covers its Retry. A page
  // opened after both inboxes' backfills never hears of them.
  await backfilled(mailbox);
  await backfilled(mailbox, work);
  let refused = 0;
  await page.route('**/email/drafts/*/transfer', async (route) => {
    if (refused > 0) return route.fallback();
    refused += 1;
    await route.fulfill({ status: 500, json: { message: 'try again' } });
  });
  const saves = watchDraftSaves(page);
  const subject = 'Moved on the second try';
  await composeNew(page, mailbox, {
    to: 'bob@example.com',
    subject,
    body: 'Numbers are in.',
  });
  const original = await routeDraftId(page);
  await expect
    .poll(() => saves.some((save) => save.html.includes('Numbers are in.')))
    .toBe(true);

  const from = page.getByRole('button', { name: 'From address' });
  await chooseFrom(page, work.email);
  const retry = page.getByRole('button', { name: 'Retry inbox change' });
  await expect(retry).toBeVisible();
  expect(refused).toBe(1);
  await expect(from).toContainText(mailbox.inbox.email);

  await retry.click();
  did('AC-021', 'F-100');
  await expect(from).toContainText(work.email);
  await expect
    .poll(() => new URL(page.url()).searchParams.get('s0.email-compose.draft'))
    .not.toBe(original);
  await routeDraftId(page);
  // The notice of the failed change stays until dismissed, over Send.
  await page
    .getByRole('status')
    .filter({ has: retry })
    .getByRole('button', { name: 'Dismiss' })
    .click();
  await page.getByRole('button', { name: 'Send email' }).click();

  const sent = await sentCopy(mailbox, subject, work.email);
  expect(sent.from).toBe(work.email);
  expect(
    (await readMailbox(mailbox, mailbox.inbox.email)).filter(
      (message) => message.subject === subject
    )
  ).toEqual([]);
});
