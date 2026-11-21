// Removing an inbox from Settings › Email: what "Remove inbox" asks about
// the user's own inbox and about one shared with them, what a refused and
// an accepted removal say, and how the signature of a shared inbox reads.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { anInbox, PROVIDERS } from './harness/providers';
import { notice } from './harness/send';
import {
  holdRequests,
  settingsSection,
  shareInbox,
} from './harness/states-settings';
import { connectedInboxes } from './harness/ways-settings';
import { openSettled } from './harness/ways-settings-more';
import { saw } from './ledger/record';

const TEAM = 'team@example.com';

test.beforeEach(({ page }) => loadAppSteadily(page));

for (const provider of PROVIDERS) {
  test.describe(`removing ${anInbox(provider)} in Settings`, () => {
    test.use({ provider });

    // When this fails, "Remove inbox" does not say that removing one's own
    // inbox clears its mail, or (Gmail) that removing a shared inbox only
    // removes access; a shared inbox's signature does not say that it goes
    // out with everyone's mail; or a removal that failed or succeeded is
    // not reported. Sharing needs a second Google account the teammate
    // connects, so the shared inbox is shown on Gmail only.
    test('Remove inbox explains what goes, and a refused then an accepted removal say so', async ({
      page,
      mailbox,
    }) => {
      const own = mailbox.inbox.email;
      if (provider === 'GMAIL') await shareInbox(mailbox, TEAM);
      await openSettled(page, mailbox);
      const dialog = page.getByRole('dialog', { name: 'Remove inbox' });

      if (provider === 'GMAIL') {
        await expect(
          settingsSection(page, 'Signatures').getByText(
            'Shared inbox. Automatically added to new emails anyone sends from this account.'
          )
        ).toBeVisible();
        saw('STX-208');
        await page.getByRole('button', { name: `Remove ${TEAM}` }).click();
        await expect(dialog).toContainText(
          `Remove access to ${TEAM}? The inbox and its data stay with its owner.`
        );
        saw('STX-204');
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog).toBeHidden();
      }

      const removing = await holdRequests(
        page,
        /\/email\/email\/links\/[^/?]+(\?|$)/,
        'DELETE'
      );
      removing.fail();
      const remove = page.getByRole('button', { name: `Remove ${own}` });
      await remove.click();
      await expect(dialog).toContainText(
        `Remove ${own}? This clears all of its email data from Macro and cannot be undone.`
      );
      saw('STX-204');
      await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
      await expect(
        notice(page, 'Failed to remove inbox. Please try again.')
      ).toBeVisible();
      saw('STX-010');
      await expect(remove).toBeVisible();

      removing.release();
      await remove.click();
      await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
      await expect(notice(page, 'Inbox removed')).toBeVisible();
      saw('STX-010');
      await expect(remove).toHaveCount(0);
      await expect
        .poll(() => connectedInboxes(mailbox))
        .toEqual(provider === 'GMAIL' ? [TEAM] : []);
    });
  });
}
