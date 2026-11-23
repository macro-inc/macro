// Reply, Reply all and Forward from a message's own buttons, and changing an
// open reply from one to another: who the composer says it writes to, and
// who the provider then holds the message for. The same for a Gmail and an
// Outlook inbox.

import type { Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { type ReadMessage, readMailbox } from './harness/journeys';
import { notice, replyEditor } from './harness/send';
import type { Provider } from './harness/stack';
import { confirmed, did, saw } from './ledger/record';

const XAVIER = 'xavier@example.com';
const YARA = 'yara@example.com';
const ZED = 'zed@example.com';
const QUESTION = 'Which dates work?';

/** A message from Xavier to the inbox with Yara in Cc, opened in its thread. */
async function openOffsite(page: Page, mailbox: Mailbox): Promise<void> {
  await mailbox.deliver({
    from: `Xavier <${XAVIER}>`,
    to: mailbox.inbox.email,
    cc: `Yara <${YARA}>`,
    subject: 'Offsite',
    text: QUESTION,
  });
  const thread = await mailbox.synced('Offsite');
  await mailbox.open(`/app/mail/${thread.id}`);
  did('AL-910');
  await expect(page.getByText(QUESTION).first()).toBeVisible();
}

/** Presses one of the message's own buttons, which show while it is hovered. */
async function pressMessageButton(
  page: Page,
  name: 'Reply' | 'Reply all' | 'Forward'
): Promise<void> {
  await page.getByText(QUESTION).first().hover();
  await page.getByRole('button', { name, exact: true }).click();
}

/** The one message the inbox sent with this subject, as the provider holds it. */
async function sentCopy(
  mailbox: Mailbox,
  subject: string
): Promise<ReadMessage> {
  const sent = async () =>
    (await readMailbox(mailbox, mailbox.inbox.email)).filter(
      (message) =>
        message.subject === subject && message.from === mailbox.inbox.email
    );
  await expect
    .poll(async () => (await sent()).length, {
      message: `the provider never received "${subject}"`,
      timeout: 30_000,
    })
    .toBe(1);
  return (await sent())[0];
}

const PROVIDERS: Provider[] = ['GMAIL', 'OUTLOOK'];

for (const provider of PROVIDERS) {
  test.describe(`a message's Reply, Reply all and Forward, ${provider === 'GMAIL' ? 'a Gmail' : 'an Outlook'} inbox`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, Reply writes to more people than the sender, or the
    // reply never reaches the provider.
    test('Reply writes to the sender alone', async ({ page, mailbox }) => {
      await openOffsite(page, mailbox);
      await pressMessageButton(page, 'Reply');
      did('AL-168');
      await expect(
        page.getByRole('button', { name: 'Replying to Xavier', exact: true })
      ).toBeVisible();
      saw('STC-094', 'F-108');
      await replyEditor(page).pressSequentially('Any week in May.');
      did('AC-081');
      await page.getByRole('button', { name: 'Send email' }).click();
      did('AC-091');
      await expect(notice(page, 'Email sent')).toBeVisible();
      saw('STC-025');

      const reply = await sentCopy(mailbox, 'Re: Offsite');
      expect(reply.to).toEqual([XAVIER]);
      expect(reply.cc).toEqual([]);
      expect(reply.html).toContain('Any week in May.');
      confirmed('F-108');
    });

    // When this fails, Reply all leaves out the people in Cc, or writes to
    // the replying inbox itself.
    test('Reply all writes to the sender and keeps Cc', async ({
      page,
      mailbox,
    }) => {
      await openOffsite(page, mailbox);
      await pressMessageButton(page, 'Reply all');
      did('AL-169');
      await expect(
        page.getByRole('button', {
          name: 'Replying to Xavier + 1',
          exact: true,
        })
      ).toBeVisible();
      saw('STC-094', 'F-109');
      await replyEditor(page).pressSequentially('Any week in May.');
      did('AC-081');
      await page.getByRole('button', { name: 'Send email' }).click();
      did('AC-091');
      await expect(notice(page, 'Email sent')).toBeVisible();
      saw('STC-025');

      const reply = await sentCopy(mailbox, 'Re: Offsite');
      expect(reply.to).toEqual([XAVIER]);
      expect(reply.cc).toEqual([YARA]);
      expect(reply.html).toContain('Any week in May.');
      confirmed('F-109');
    });

    // When this fails, Forward opens a reply to the sender, or the forwarded
    // message goes out without the original.
    test('Forward writes to the person added, with the original below', async ({
      page,
      mailbox,
    }) => {
      await openOffsite(page, mailbox);
      await pressMessageButton(page, 'Forward');
      did('AL-170');
      await expect(
        page.getByRole('textbox', { name: /^Forward — / })
      ).toBeVisible();
      await page.getByRole('combobox').fill(ZED);
      await page.keyboard.press('Enter');
      did('AC-077', 'F-097');
      did('AC-003');
      await expect(page.getByRole('link', { name: ZED })).toBeVisible();
      saw('STC-958');
      await replyEditor(page).click();
      await replyEditor(page).pressSequentially('See below.');
      did('AC-081');
      // A press outside the composer folds its envelope to one line.
      await page.getByText(QUESTION).first().click();
      await expect(
        page.getByRole('button', { name: `Forwarding ${ZED}`, exact: true })
      ).toBeVisible();
      saw('STC-094', 'F-110');
      await page.getByRole('button', { name: 'Send email' }).click();
      did('AC-091');
      await expect(notice(page, 'Email sent')).toBeVisible();
      saw('STC-025');

      const forward = await sentCopy(mailbox, 'Fwd: Offsite');
      expect(forward.to).toEqual([ZED]);
      expect(forward.cc).toEqual([]);
      confirmed('F-097');
      expect(forward.html).toContain('See below.');
      expect(forward.html).toContain('Forwarded message');
      expect(forward.html).toContain(QUESTION);
      confirmed('F-110');
    });

    // When this fails, an open reply stays what it was when another of the
    // message's buttons is pressed, or loses what was typed.
    test('an open reply becomes a forward, then a reply to the sender, and keeps its text', async ({
      page,
      mailbox,
    }) => {
      await openOffsite(page, mailbox);
      await pressMessageButton(page, 'Reply all');
      did('AL-169');
      await expect(
        page.getByRole('button', {
          name: 'Replying to Xavier + 1',
          exact: true,
        })
      ).toBeVisible();
      saw('STC-094', 'F-109');
      await replyEditor(page).pressSequentially('Any week in May.');
      did('AC-081');

      await pressMessageButton(page, 'Forward');
      did('AC-113');
      await expect(
        page.getByRole('textbox', { name: /^Forward — / })
      ).toContainText('Any week in May.');
      await expect(
        page.getByRole('textbox', { name: /^Reply — / })
      ).toHaveCount(0);
      // A forward starts with nobody to write to.
      await expect(page.getByRole('link', { name: XAVIER })).toHaveCount(0);
      await expect(page.getByRole('link', { name: YARA })).toHaveCount(0);
      saw('STC-937');

      await pressMessageButton(page, 'Reply');
      did('AC-113');
      await expect(
        page.getByRole('textbox', { name: /^Reply — / })
      ).toContainText('Any week in May.');
      await page.getByText(QUESTION).first().click();
      await expect(
        page.getByRole('button', { name: 'Replying to Xavier', exact: true })
      ).toBeVisible();
      saw('STC-937');
    });
  });
}
