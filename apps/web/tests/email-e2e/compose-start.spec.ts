// How a new message starts and who it is for: the composer a mailto link
// opens, and taking a recipient out or moving one from To to Cc before the
// message is sent. The same for a Gmail and an Outlook inbox.

import { composeNew, loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { type ReadMessage, readMailbox } from './harness/journeys';
import { notice } from './harness/send';
import type { Provider } from './harness/stack';
import { confirmed, did, saw } from './ledger/record';

const BOB = 'bob@example.com';
const CAROL = 'carol@example.com';
const DAVE = 'dave@example.com';

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
  test.describe(`starting a message and its recipients, ${provider === 'GMAIL' ? 'a Gmail' : 'an Outlook'} inbox`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a mailto link in a message no longer opens a new email
    // to its address: it opens nothing, or a composer without the recipient.
    test('a mailto link in a message opens a new email to its address', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from: 'Xavier <xavier@example.com>',
        subject: 'Offsite',
        html: `<p>Which dates work?</p><p><a href="mailto:${CAROL}">Write to the organiser</a></p>`,
      });
      const thread = await mailbox.synced('Offsite');
      await mailbox.open(`/app/mail/${thread.id}`);
      did('AL-910');

      await page
        .getByRole('link', { name: 'Write to the organiser' })
        .first()
        .click();
      did('AC-112');
      did('AX-302');

      await expect(page).toHaveURL(/\/app\/mail\/new/);
      await expect(page.getByPlaceholder(/subject/i)).toHaveValue('');
      const fields = page
        .getByRole('group')
        .filter({ has: page.getByRole('combobox') });
      await expect(
        fields.first().getByRole('link', { name: CAROL })
      ).toBeVisible();
      saw('STX-300');
    });

    // When this fails, Backspace in the To field no longer takes the last
    // recipient out, or a recipient dragged onto Cc stays in To: the message
    // goes to people the writer removed, or in the wrong field.
    test('a recipient taken out is not written to, and one dragged to Cc is copied', async ({
      page,
      mailbox,
    }) => {
      await composeNew(page, mailbox, {
        to: BOB,
        subject: 'Seating plan',
        body: 'Draft attached soon.',
      });
      const to = page.getByRole('combobox').first();
      for (const address of [CAROL, DAVE]) {
        await to.fill(address);
        await to.press('Enter');
        did('AC-003');
        await expect(page.getByRole('link', { name: address })).toBeVisible();
      }

      await to.press('Backspace');
      did('AC-007');
      await expect(page.getByRole('link', { name: DAVE })).toHaveCount(0);
      saw('STC-932');

      await page.getByRole('button', { name: 'Cc', exact: true }).click();
      const fields = page
        .getByRole('group')
        .filter({ has: page.getByRole('combobox') });
      await expect(fields).toHaveCount(2);
      await page
        .getByRole('link', { name: CAROL })
        .dragTo(fields.nth(1).getByRole('combobox'));
      did('AC-010');
      await expect(
        fields.nth(1).getByRole('link', { name: CAROL })
      ).toBeVisible();
      await expect(
        fields.nth(0).getByRole('link', { name: CAROL })
      ).toHaveCount(0);
      await expect(
        fields.nth(0).getByRole('link', { name: BOB })
      ).toBeVisible();
      saw('STC-932');

      await page.getByRole('button', { name: 'Send email' }).click();
      did('AC-057');
      await expect(notice(page, 'Email sent')).toBeVisible();

      const sent = await sentCopy(mailbox, 'Seating plan');
      expect(sent.to).toEqual([BOB]);
      expect(sent.cc).toEqual([CAROL]);
      expect(sent.bcc).toEqual([]);
      confirmed('F-098');
    });
  });
}
