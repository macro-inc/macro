// What Settings › Email shows around its accounts besides the accounts
// themselves: each section while the inboxes load and when they cannot be
// loaded, the sections of a user without an inbox, a read-receipts switch
// the service refused, and the Outlook row the server does not offer or
// closed after it was shown.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { notice } from './harness/send';
import { holdRequests, settingsSection } from './harness/states-settings';
import { removeInbox, SETTINGS } from './harness/ways-settings';
import { saw } from './ledger/record';

const LINKS = /\/email\/email\/links(\?|$)/;

test.beforeEach(({ page }) => loadAppSteadily(page));

// The loading and failed states are drawn from the inbox list alone, the
// same for a Gmail and an Outlook inbox, so these run on Gmail only.
test.describe('Settings › Email of a Gmail inbox', () => {
  // When this fails, Settings › Email shows nothing while its inboxes load,
  // leaves the signatures blank (or loading for good) when they cannot be
  // loaded, offers no way to try again, or says nothing when the service
  // refuses a read-receipts switch.
  test('says the inboxes are loading, offers Try again when they fail, and says a refused read-receipts switch failed', async ({
    page,
    mailbox,
  }) => {
    const own = mailbox.inbox.email;
    const listing = await holdRequests(page, LINKS, 'GET');
    await mailbox.open(SETTINGS);

    const signatures = settingsSection(page, 'Signatures');
    const receipts = settingsSection(page, 'Read receipts');
    // Accounts itself draws its rows without waiting for the list (they read
    // it without suspending), so its own "Loading accounts…" fallback is not
    // what shows; the one under Read receipts is.
    await expect(receipts.getByRole('status')).toHaveText('Loading accounts…');
    saw('STX-001');
    await expect(signatures.getByRole('status')).toHaveText(
      'Loading signatures…'
    );
    saw('STX-003');

    listing.fail();
    await expect(signatures.getByText("Couldn't load signatures")).toBeVisible({
      timeout: 45_000,
    });
    const retry = signatures.getByRole('button', { name: 'Try again' });
    await expect(retry).toBeVisible();
    saw('STX-004');

    listing.release();
    await retry.click();
    await expect(
      page.getByRole('tablist', { name: `Signature views for ${own}` })
    ).toBeVisible();
    await expect(signatures.getByText("Couldn't load signatures")).toBeHidden();

    // The service refuses the switch: it flips back and says so.
    await page.route(/\/email\/email\/settings(\?|$)/, (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({ status: 500, json: {} })
        : route.fallback()
    );
    const toggle = receipts.getByRole('switch', {
      name: `Read receipts for ${own}`,
    });
    await expect(toggle).toBeChecked();
    await toggle.locator('xpath=following-sibling::div[1]').click();
    await expect(notice(page, 'Failed to update read receipts.')).toBeVisible();
    saw('STX-013');
    await expect(toggle).toBeChecked();
  });

  // When this fails, a user whose inbox is gone sees empty Signatures and
  // Read receipts sections instead of being told to connect an account.
  test('without an inbox, Signatures and Read receipts ask to connect an account', async ({
    page,
    mailbox,
  }) => {
    await removeInbox(mailbox);
    await mailbox.open(SETTINGS);
    await expect(
      settingsSection(page, 'Signatures').getByText(
        'Connect an email account above to add a signature.'
      )
    ).toBeVisible();
    saw('STX-005');
    await expect(
      settingsSection(page, 'Read receipts').getByText(
        'Connect an email account above to use read receipts.'
      )
    ).toBeVisible();
    saw('STX-006');
    await expect(
      page.getByRole('button', { name: 'Connect a Google Workspace account' })
    ).toBeVisible();
  });
});

// Whether Outlook is offered is the server's answer, whatever inbox the
// user has; the row asks for an Outlook mailbox (the row's provider).
test.describe('Settings › Email of an Outlook inbox', () => {
  test.use({ provider: 'OUTLOOK' });

  // When this fails, Settings offers new Outlook connections the server
  // does not offer, or a click on one after the server closed them starts
  // a connection, or does nothing, instead of saying they are unavailable.
  test('hides Outlook when the server does not offer it, and says so when it closed after the row was shown', async ({
    page,
    mailbox,
  }) => {
    let offered = false;
    mailbox.front.stub(({ path }) =>
      path === '/auth/link/email/providers'
        ? { json: { outlook: offered, outlook_admin_consent_url: null } }
        : undefined
    );
    const google = page.getByRole('button', {
      name: 'Connect a Google Workspace account',
    });
    const outlook = page.getByRole('button', {
      name: 'Connect an Outlook account',
    });

    const providersRead = page.waitForResponse((response) =>
      response.url().includes('/auth/link/email/providers')
    );
    await mailbox.open(SETTINGS);
    await providersRead;
    await expect(google).toBeVisible();
    await expect(outlook).toHaveCount(0);
    saw('STX-200');

    offered = true;
    await page.reload();
    await expect(outlook).toBeVisible();
    offered = false;
    await outlook.click();
    await expect(
      notice(page, 'New Outlook connections are temporarily unavailable.')
    ).toBeVisible();
    saw('STX-012');
    await expect(page).toHaveURL(new RegExp(`${SETTINGS}$`));
  });
});
