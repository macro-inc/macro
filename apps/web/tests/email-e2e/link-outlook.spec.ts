import { expect, test } from './harness/fixtures';

test.describe('an Outlook inbox in Settings', () => {
  test.use({ provider: 'OUTLOOK' });

  // Class link-connect-flow-ui: Settings must show a connected Outlook inbox
  // as an Outlook account that has finished syncing. When this fails the row
  // stays on "Syncing…" for good, because Settings waits for a Gmail-style
  // backfill that Outlook never runs, or the row offers Gmail-only actions.
  test('is listed as an Outlook account that is not left syncing', async ({
    page,
    mailbox,
  }) => {
    await mailbox.deliver({
      from: 'Grace <grace@example.com>',
      subject: 'Lunch?',
      text: 'Noon at the usual place?',
    });
    await mailbox.synced('Lunch?');

    await mailbox.open('/app/mail/~/settings/email');

    const remove = page.getByRole('button', {
      name: `Remove ${mailbox.inbox.email}`,
    });
    await expect(remove).toBeVisible();
    await expect(
      page.getByText('Outlook / Microsoft 365').first()
    ).toBeVisible();
    // The status is part of the row's own data and an inbox that is up to
    // date shows none, so the row being there is what these wait on.
    await expect(page.getByText('Syncing…')).toBeHidden();
    await expect(page.getByText('Reconnect to resume sync')).toBeHidden();
  });
});
