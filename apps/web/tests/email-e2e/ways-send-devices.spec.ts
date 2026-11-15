// A send seen from the Queued email sends panel (in Drafts) of another
// device, which holds none of the sending browser's queue, while the
// service still holds it for its Undo window: Check status there asks the
// service again, and Cancel and restore takes the send back to a draft. The
// browser that sent it then offers Restore draft for a send cancelled
// elsewhere. For a Gmail and an Outlook inbox.

import type { Page } from '@playwright/test';
import { composeNew, draftThreads, loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { anInbox, PROVIDERS } from './harness/providers';
import { sentMessages } from './harness/send';
import {
  anotherDevice,
  openSendAttempts,
  setSendUnconfirmed,
} from './harness/ways-send-more';
import { did } from './ledger/record';

const SUBJECT = 'Held numbers';

async function draftNames(mailbox: Mailbox): Promise<string[]> {
  return (await draftThreads(mailbox)).map((thread) => String(thread.name));
}

/** The Queued email sends panel, from the Drafts tab of the mail list. */
async function sendsInDrafts(page: Page) {
  await page
    .getByRole('navigation', { name: 'Email tabs' })
    .getByRole('button', { name: 'Drafts' })
    .click();
  return page.getByLabel('Queued email sends');
}

for (const provider of PROVIDERS) {
  test.describe(`a send seen on another device during its Undo window, in ${anInbox(provider)}`, () => {
    // Long enough an Undo window that the send waits through the test.
    test.use({ provider, stackEnv: { SENT_UNDO_DELAY_SECS: '120' } });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, the other device's Check status does not ask the
    // service again (the row keeps saying delivery is unconfirmed), its
    // Cancel and restore leaves the message waiting to go out instead of
    // a draft, or the sending browser's Restore draft leaves the send
    // cancelled elsewhere in its panel.
    test('Check status and Cancel and restore there, then Restore draft here', async ({
      page,
      mailbox,
      browser,
    }) => {
      await composeNew(page, mailbox, {
        to: 'grace@example.com',
        subject: SUBJECT,
        body: 'The numbers are in.',
      });
      await page.getByRole('button', { name: 'Send email' }).click();
      await expect.poll(() => openSendAttempts(mailbox)).toBe(1);
      await setSendUnconfirmed(mailbox, true);

      const other = await anotherDevice(browser, mailbox);
      try {
        const there = await sendsInDrafts(other.page);
        await expect(there.getByText(SUBJECT)).toBeVisible();
        const unconfirmed = there
          .getByRole('status')
          .filter({ hasText: 'Delivery unconfirmed.' });
        await expect(unconfirmed).toBeVisible();

        // The service holds it as waiting for its time again.
        await setSendUnconfirmed(mailbox, false);
        await there
          .getByRole('button', { name: 'Check status', exact: true })
          .click();
        did('AC-109');
        await expect(
          there.getByRole('status').filter({ hasText: /^Scheduled/ })
        ).toBeVisible();
        await expect(unconfirmed).toHaveCount(0);

        await there
          .getByRole('button', { name: 'Cancel and restore', exact: true })
          .click();
        did('AC-108', 'F-136');
        await expect.poll(() => openSendAttempts(mailbox)).toBe(0);
        await expect.poll(() => draftNames(mailbox)).toEqual([SUBJECT]);
        await expect(there).toHaveCount(0);
      } finally {
        await other.close();
      }

      const here = await sendsInDrafts(page);
      await expect(
        here.getByRole('status').filter({ hasText: 'Send cancelled' })
      ).toBeVisible();
      await here
        .getByRole('button', { name: 'Restore draft', exact: true })
        .click();
      did('AC-105');
      await expect(here).toHaveCount(0);
      expect(await draftNames(mailbox)).toEqual([SUBJECT]);
      expect(await sentMessages(mailbox)).toEqual([]);
    });
  });
}
