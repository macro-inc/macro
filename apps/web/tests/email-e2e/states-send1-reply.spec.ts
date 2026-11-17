// What a reply composer in a thread says when a send or a schedule cannot
// finish: a forward with no one to send to, a schedule whose thread could
// not be marked done, an Undo whose thread could not be put back in the
// inbox (after a schedule and after Send and mark done), and a send before
// the inbox's sender addresses have loaded.

import type { Page } from '@playwright/test';
import { graphqlOperation, loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { notice, replyEditor } from './harness/send';
import type { Provider } from './harness/stack';
import {
  archiveRequest,
  hold,
  operation,
  refuse,
} from './harness/states-send1';
import {
  clock,
  openPicker,
  preset,
  scheduled,
  scheduledNotice,
} from './harness/ways-send';
import { saw } from './ledger/record';

const PROVIDERS: Provider[] = ['GMAIL', 'OUTLOOK'];

/** Delivers a message from grace and returns its thread's id once synced. */
async function threadFrom(
  mailbox: Mailbox,
  subject: string,
  text: string
): Promise<string> {
  await mailbox.deliver({ from: 'Grace <grace@example.com>', subject, text });
  return (await mailbox.synced(subject)).id;
}

/** Opens a thread and starts a reply to it. */
async function reply(
  page: Page,
  mailbox: Mailbox,
  threadId: string,
  text: string
): Promise<void> {
  await mailbox.open(`/app/mail/${threadId}`);
  await page.getByText('Reply...').click();
  await replyEditor(page).pressSequentially(text);
}

/** Gives the reply a time tomorrow and presses Schedule send. */
async function scheduleForTomorrow(page: Page): Promise<void> {
  await openPicker(page, clock(page));
  await preset(page, 'Tomorrow').click();
  await page
    .getByRole('button', { name: 'Schedule send', exact: true })
    .click();
}

for (const provider of PROVIDERS) {
  test.describe(`what a reply says when it cannot finish, ${provider === 'GMAIL' ? 'Gmail' : 'Outlook'} inbox`, () => {
    test.use({ provider });
    // The service holds a send this long, so Undo of a send is on offer.
    test.use({ stackEnv: { SENT_UNDO_DELAY_SECS: '45' } });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a reply that only partly worked says nothing: a
    // forward with no recipient seems to go, a scheduled reply leaves its
    // thread in the inbox without saying so, or Undo leaves the thread out
    // of the inbox while the user believes it is back.
    test('a forward to no one, a thread not marked done and a thread not put back say so', async ({
      page,
      mailbox,
    }) => {
      const picnic = await threadFrom(mailbox, 'Picnic?', 'Bring a blanket?');
      const lunch = await threadFrom(mailbox, 'Lunch?', 'Noon at the usual?');
      const dinner = await threadFrom(mailbox, 'Dinner?', 'Eight tonight?');

      await mailbox.open(`/app/mail/${picnic}`);
      await page.getByText('Bring a blanket?').first().hover();
      await page.getByRole('button', { name: 'Forward', exact: true }).click();
      await replyEditor(page).pressSequentially('See below.');
      await page.getByRole('button', { name: 'Send email' }).click();
      await expect(
        notice(page, 'Email failed to send. No recipients provided')
      ).toBeVisible();
      saw('STC-039');

      // Scheduled, but the thread could not be taken out of the inbox.
      await reply(page, mailbox, lunch, 'Works for me.');
      await refuse(page, archiveRequest(true));
      await scheduleForTomorrow(page);
      await expect(
        notice(page, 'Email scheduled, but unable to mark thread done')
      ).toBeVisible();
      saw('STC-064');
      await scheduledNotice(page).getByRole('button', { name: 'Undo' }).click();
      await expect(notice(page, /^Schedule cancelled\.$/)).toBeVisible();
      await expect.poll(() => scheduled(mailbox)).toEqual([]);

      // Scheduled and marked done; Undo cannot put the thread back.
      await scheduleForTomorrow(page);
      await expect(scheduledNotice(page)).toBeVisible({ timeout: 30_000 });
      await expect.poll(async () => (await scheduled(mailbox)).length).toBe(1);
      const restore = await refuse(page, archiveRequest(false));
      await scheduledNotice(page).getByRole('button', { name: 'Undo' }).click();
      const notBack = notice(page, 'Failed to restore thread to inbox');
      await expect(notBack).toBeVisible();
      saw('STC-044', 'F-144');
      expect(restore()).toBe(1);
      await page.mouse.move(0, 0);
      await expect(notBack).toHaveCount(0);

      // Sent and marked done; Undo of the send cannot put the thread back.
      await reply(page, mailbox, dinner, 'See you there.');
      const accepted = page.waitForResponse(
        (response) =>
          graphqlOperation(response.request()) === 'SendEmailMessage' &&
          response.ok()
      );
      const markedDone = page.waitForResponse(
        (response) => archiveRequest(true)(response.request()) && response.ok()
      );
      await page.keyboard.press('Shift+ControlOrMeta+Enter');
      await accepted;
      await markedDone;
      const restoreAfterSend = await refuse(page, archiveRequest(false));
      await notice(page, 'Sending…')
        .last()
        .getByRole('button', { name: 'Undo' })
        .click();
      await expect(notBack).toBeVisible({ timeout: 30_000 });
      saw('STC-044', 'F-134');
      expect(restoreAfterSend()).toBe(1);
    });
  });
}

test.describe('a reply sent before the sender addresses load', () => {
  // Gmail only: the composer's own guard, the same code whatever the mailbox.
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, a reply sent before the inbox's addresses arrive goes
  // out from a guessed address, or nothing tells the user to wait.
  test('says the sender addresses are loading', async ({ page, mailbox }) => {
    const lunch = await threadFrom(mailbox, 'Lunch?', 'Noon at the usual?');
    const accounts = await hold(page, operation('MailAccounts'));
    await reply(page, mailbox, lunch, 'Works for me.');
    await page.getByRole('button', { name: 'Send email' }).click();
    await expect(
      notice(page, 'Loading email sender addresses...')
    ).toBeVisible();
    saw('STC-038');
    expect(accounts.count()).toBeGreaterThan(0);
    await accounts.release();
  });
});
