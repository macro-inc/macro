// What an open thread says about a mailbox write that needs the user: a
// change the mailbox refused, a reply whose draft changed in the mailbox
// (the choice failing, then made), and a reply whose delivery could not be
// confirmed (sending it again asks first).
//
// Outlook only: only an Outlook mailbox takes Macro's changes as operations
// the thread lists, and only an Outlook inbox has its drafts written into
// the mailbox (crates/email/src/outbound/mailbox_pg/drafts.rs, the
// `l.provider = 'OUTLOOK'` claim), so only there can a draft conflict or a
// send stay unconfirmed. A Gmail inbox's drafts and sends stay in Macro.

import type { Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { rowIds } from './harness/list';
import { injectFault, replyEditor } from './harness/send';
import { draftAtProvider, editDraftAtProvider } from './harness/ways-send-more';
import { allRead, openFromList } from './harness/ways-thread';
import { saw } from './ledger/record';

const FROM = 'Grace <grace@example.com>';

/** Delivers a message and answers its thread's id once Macro has it. */
async function delivered(mailbox: Mailbox, subject: string): Promise<string> {
  await mailbox.deliver({ from: FROM, subject, text: `About ${subject}.` });
  return (await mailbox.synced(subject)).id;
}

/** The thread's mailbox operations, as the service lists them. */
async function operations(mailbox: Mailbox, id: string) {
  const response = await mailbox.api(`/email/email/threads/${id}/operations`);
  return (
    (await response.json()) as {
      action: { kind: string; value: unknown };
      state: string;
    }[]
  ).map(({ action, state }) => ({ ...action, state }));
}

/**
 * Moves the start of the inbox's unconfirmed send back past the ten minutes
 * the service waits for the mailbox to show it sent (`UNCERTAIN_WAIT` in
 * crates/email/src/domain/mailbox/drafts.rs), and lets it look again now.
 * Answers how many sends it moved: none until the send waits for
 * confirmation.
 */
async function unconfirmedForTenMinutes(mailbox: Mailbox): Promise<number> {
  const rows = await mailbox.stack.sql(
    `UPDATE email_mailbox_drafts
     SET checkpoint = jsonb_set(checkpoint, '{stage_started_at}', to_jsonb(
           to_char((now() - interval '11 minutes') AT TIME ZONE 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
         available_at = now()
     WHERE link_id = '${mailbox.inbox.linkId}'
       AND checkpoint->>'stage' = 'confirming'
     RETURNING message_id`
  );
  return rows.length;
}

/** Opens the thread's reply composer and writes `text`. */
async function reply(page: Page, text: string): Promise<void> {
  await page.getByText('Reply...').click();
  await replyEditor(page).pressSequentially(text);
}

test.describe('the mailbox writes an open thread waits on, in an Outlook inbox', () => {
  test.use({ provider: 'OUTLOOK' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, a thread marked unread that the mailbox then refuses
  // does not say the change failed, so the user believes Outlook holds it
  // unread.
  test('marking unread refused by the mailbox', async ({ page, mailbox }) => {
    const agenda = await delivered(mailbox, 'Agenda');
    await delivered(mailbox, 'Minutes');
    await page.setViewportSize({ width: 1600, height: 900 });
    await mailbox.open();
    await expect.poll(() => rowIds(page)).toContain(agenda);
    await page.getByRole('button', { name: 'Show reading pane' }).click();
    await openFromList(page, agenda, 'About Agenda.');
    // Opening it marked it read; that is done before the unread is asked.
    await allRead(mailbox, agenda);
    await expect
      .poll(() => operations(mailbox, agenda))
      .toEqual([{ kind: 'read', value: true, state: 'applied' }]);

    await injectFault(mailbox, {
      route: 'messages.update',
      error: 'forbidden',
    });
    await page.getByRole('heading', { name: 'Agenda', level: 1 }).click();
    await page.keyboard.press('u');
    await expect(
      page.getByText(
        'Mark as unread: Could not apply this change. Try the action again.'
      )
    ).toBeVisible({ timeout: 30_000 });
    saw('STL-081');
  });

  // When this fails, a reply whose draft changed in the mailbox does not
  // say when taking the mailbox's version could not be done, or, once it
  // is done, does not say the mailbox version is ready nor offer Reload
  // draft.
  test("a reply's draft changed in the mailbox: its version refused, then ready", async ({
    page,
    mailbox,
  }) => {
    const id = await delivered(mailbox, 'Offsite');
    await mailbox.open(`/app/mail/${id}`);
    await expect(page.getByText('About Offsite.').first()).toBeVisible();
    await reply(page, 'Thinking of the coast.');
    await expect
      .poll(async () => (await draftAtProvider(mailbox, 'Re: Offsite'))?.body, {
        timeout: 30_000,
      })
      .toContain('Thinking of the coast.');
    await editDraftAtProvider(mailbox, 'Re: Offsite', 'From the phone.');
    await replyEditor(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(' Or the hills.');
    const notice = page
      .getByRole('status')
      .filter({ hasText: 'This draft changed in your mailbox.' });
    await expect(notice).toBeVisible({ timeout: 30_000 });

    let refusing = true;
    await page.route(/\/email\/drafts\/[^/]+\/resolve(\?|$)/, (route) =>
      refusing && route.request().method() === 'POST'
        ? route.fulfill({ status: 500, body: '{}' })
        : route.fallback()
    );
    await notice
      .getByRole('button', { name: 'Use mailbox version', exact: true })
      .click();
    const confirm = notice.getByRole('button', {
      name: 'Confirm',
      exact: true,
    });
    await confirm.click();
    await expect(notice.getByRole('alert')).toHaveText(
      'The operation could not be completed. Refresh this draft and try again.'
    );
    saw('STL-085');

    refusing = false;
    await confirm.click();
    const ready = page
      .getByRole('status')
      .filter({ hasText: 'The mailbox version is ready.' });
    await expect(ready).toContainText(
      'The mailbox version is ready. Reload the draft to continue editing.',
      { timeout: 30_000 }
    );
    await expect(
      ready.getByRole('button', { name: 'Reload draft' })
    ).toBeVisible();
    saw('STL-084');
  });

  // When this fails, sending again a reply whose delivery could not be
  // confirmed does not ask first: no box to tick that a duplicate may go
  // out, or Confirm is enabled before it is ticked (or stays disabled after).
  test('a reply whose delivery could not be confirmed, sent again', async ({
    page,
    mailbox,
  }) => {
    const id = await delivered(mailbox, 'Lunch?');
    // The mailbox answers the send with a server error: it may or may not
    // have sent it, and its Sent mail never shows it.
    await injectFault(mailbox, {
      route: 'messages.send',
      error: 'internal',
      times: 1,
    });
    await mailbox.open(`/app/mail/${id}`);
    await expect(page.getByText('About Lunch?.').first()).toBeVisible();
    await reply(page, 'Works for me.');
    await page.getByRole('button', { name: 'Send email' }).click();
    // Ten minutes later the service gives up waiting for the mailbox.
    await expect
      .poll(() => unconfirmedForTenMinutes(mailbox), { timeout: 30_000 })
      .toBe(1);
    const status = page
      .getByRole('status')
      .filter({ hasText: 'Delivery could not be confirmed.' });
    await expect(status).toBeVisible({ timeout: 30_000 });

    await status.getByRole('button', { name: 'Retry send' }).click();
    await expect(status).toContainText(
      'Send this email again? The earlier attempt may already have reached its recipients.'
    );
    const confirm = status.getByRole('button', {
      name: 'Confirm',
      exact: true,
    });
    await expect(confirm).toBeDisabled();
    await status
      .getByRole('checkbox', {
        name: 'I understand this may send a duplicate email.',
      })
      .check();
    await expect(confirm).toBeEnabled();
    saw('STL-520', 'F-140');
  });
});
