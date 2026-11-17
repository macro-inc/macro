// Settings › Integrations lists Gmail and Outlook as one row each; "Manage"
// on the row of a provider with a connected inbox opens Settings › Email,
// where that provider's inboxes are managed.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { anInbox, PROVIDERS } from './harness/providers';
import { settingsSection } from './harness/states-settings';
import { did } from './ledger/record';

const INTEGRATIONS = '/app/mail/~/settings/connections';

test.beforeEach(({ page }) => loadAppSteadily(page));

for (const provider of PROVIDERS) {
  test.describe(`Settings › Integrations with ${anInbox(provider)}`, () => {
    test.use({ provider });

    // When this fails, Manage on the provider's row does nothing, or opens
    // some page other than Settings › Email with the connected inbox.
    test('Manage on the provider row opens Settings › Email', async ({
      page,
      mailbox,
    }) => {
      const own = mailbox.inbox.email;
      await mailbox.open(INTEGRATIONS);
      const row = page
        .getByRole('table', { name: 'Integrations' })
        .getByRole('row')
        .filter({ hasText: provider === 'GMAIL' ? 'Gmail' : 'Outlook' });
      await row.getByRole('button', { name: 'Manage', exact: true }).click();
      did('AX-327');
      await expect(page).toHaveURL(/\/settings\/email$/);
      await expect(
        page.getByRole('heading', { name: 'Email', level: 1 })
      ).toBeVisible();
      await expect(
        settingsSection(page, 'Accounts').getByRole('button', {
          name: `Remove ${own}`,
        })
      ).toBeVisible();
    });
  });
}
