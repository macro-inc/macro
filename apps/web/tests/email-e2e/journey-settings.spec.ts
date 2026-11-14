// Journey: Settings › Email. A signature written there is in the next sent
// message; read receipts turned off leave the next message without Macro's
// open pixel and turned on again put it back; a removed inbox leaves the
// accounts, the mail list and the inbox picker. The same journey for a Gmail
// and an Outlook inbox.

import type { Page } from '@playwright/test';
import { composeNew, loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { addMailbox, readMailbox } from './harness/journeys';
import { notice } from './harness/send';
import type { Provider } from './harness/stack';
import { confirmed, did, saw } from './ledger/record';

const SETTINGS = '/app/mail/~/settings/email';

/** Macro's open pixel, as it is put into a tracked message. */
const PIXEL = /\/opens\/[\w-]{43}/;

/**
 * Flips a switch the way a pointer does: the switch's input is visually
 * hidden under its track, so the click goes to the track.
 */
async function setSwitch(page: Page, name: string, on: boolean) {
  const toggle = page.getByRole('switch', { name });
  await expect(toggle).toBeChecked({ checked: !on });
  await toggle.locator('xpath=following-sibling::div[1]').click();
  did('AX-014');
  await expect(toggle).toBeChecked({ checked: on });
  saw('STX-964');
}

const PROVIDERS: Provider[] = ['GMAIL', 'OUTLOOK'];

for (const provider of PROVIDERS) {
  test.describe(`email settings of ${provider === 'GMAIL' ? 'a Gmail' : 'an Outlook'} inbox`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a setting saved in Settings › Email does not change the
    // next sent message, or a removed inbox's mail and picker entry remain.
    test('a signature, read receipts off and on, and removing an inbox', async ({
      page,
      mailbox,
    }) => {
      const grace = 'grace@example.com';
      const work = 'work@example.com';
      await addMailbox(mailbox, grace);
      const workInbox = await mailbox.stack.link(mailbox.user, provider, work);
      await mailbox.stack.deliver(workInbox.email, {
        from: 'Linus <linus@example.com>',
        subject: 'Budget',
        text: 'Numbers attached.',
      });
      await mailbox.deliver({
        from: `Grace <${grace}>`,
        subject: 'Lunch?',
        text: 'Noon?',
      });
      await mailbox.synced('Lunch?');
      const received = async () =>
        (await readMailbox(mailbox, grace)).filter(
          (message) => message.from === mailbox.inbox.email
        );
      const send = async (subject: string) => {
        await composeNew(page, mailbox, {
          to: grace,
          subject,
          body: `About ${subject}.`,
        });
        await page.getByRole('button', { name: 'Send email' }).click();
        did('AC-057');
        await expect(notice(page, 'Email sent')).toBeVisible();
        saw('STC-025');
      };

      // A signature written in Settings.
      await mailbox.open(SETTINGS);
      const own = mailbox.inbox.email;
      await page
        .getByRole('tablist', { name: `Signature views for ${own}` })
        .getByRole('tab', { name: 'HTML' })
        .click();
      did('AX-020');
      const html = page.getByRole('textbox', {
        name: `Signature HTML for ${own}`,
      });
      await html.fill('<p><b>Ada</b> at Analytical Engines</p>');
      did('AX-021');
      await page
        .locator('div')
        .filter({ has: html })
        .filter({ has: page.getByRole('button', { name: 'Save signature' }) })
        .last()
        .getByRole('button', { name: 'Save signature' })
        .click();
      did('AX-024');
      await expect(notice(page, 'Signature saved')).toBeVisible();
      saw('STX-015', 'F-148');

      // Read receipts off: the next message is signed and carries no pixel.
      await setSwitch(page, `Read receipts for ${own}`, false);
      await send('Without receipts');
      await expect
        .poll(async () => (await received()).map((message) => message.subject))
        .toEqual(['Without receipts']);
      confirmed('F-131');
      const [untracked] = await received();
      expect(untracked.html).toContain('<b>Ada</b> at Analytical Engines');
      confirmed('F-148');
      confirmed('F-149');
      confirmed('F-107');
      expect(untracked.html).not.toMatch(PIXEL);

      // On again: the next message carries it.
      await mailbox.open(SETTINGS);
      await setSwitch(page, `Read receipts for ${own}`, true);
      await send('With receipts');
      await expect
        .poll(async () => (await received()).map((message) => message.subject))
        .toEqual(['Without receipts', 'With receipts']);
      const tracked = (await received()).find(
        (message) => message.subject === 'With receipts'
      );
      expect(tracked?.html).toContain('<b>Ada</b> at Analytical Engines');
      expect(tracked?.html).toMatch(PIXEL);
      confirmed('F-067');

      // The work inbox is removed: gone from the accounts, its mail from the
      // list, and from the inbox picker.
      await mailbox.open('/app/mail');
      await expect(page.getByText('Budget')).toBeVisible();
      await mailbox.open(SETTINGS);
      await page.getByRole('button', { name: `Remove ${work}` }).click();
      did('AX-010');
      await page
        .getByRole('dialog', { name: 'Remove inbox' })
        .getByRole('button', { name: 'Remove', exact: true })
        .click();
      did('AX-011');
      await expect(
        page.getByRole('button', { name: `Remove ${work}` })
      ).toHaveCount(0);
      saw('STX-963');
      await expect
        .poll(async () => {
          const response = await mailbox.api('/email/email/links');
          const { links } = (await response.json()) as {
            links: { email_address: string }[];
          };
          return links.map((link) => link.email_address);
        })
        .toEqual([own]);
      confirmed('F-009');

      await mailbox.open('/app/mail');
      await expect(page.getByText('Lunch?')).toBeVisible();
      await expect(page.getByText('Budget')).toHaveCount(0);
      await page.getByRole('button', { name: /^Select inbox/ }).click();
      await expect(
        page.getByRole('menuitemradio', { name: own })
      ).toBeVisible();
      await expect(page.getByRole('menuitemradio', { name: work })).toHaveCount(
        0
      );
    });
  });
}
