// Forcing a sync of an inbox from Settings. The button is behind a build
// flag (`ENABLE_INBOX_RESYNC`), which the suite's bundle is built with.

import { loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { anInbox, PROVIDERS } from './harness/providers';
import { notice } from './harness/send';
import { confirmed, did, saw } from './ledger/record';

/**
 * What the email service keeps of the inbox's full imports: Gmail's are jobs,
 * and Outlook's are restarts of its folder streams.
 */
async function imports(mailbox: Mailbox): Promise<string> {
  const { linkId, provider } = mailbox.inbox;
  const rows = await mailbox.stack.sql<{ imports: string }>(
    provider === 'GMAIL'
      ? `SELECT count(*)::text AS imports FROM email_backfill_jobs WHERE link_id = '${linkId}'`
      : `SELECT coalesce(max(import_started_at)::text, '') AS imports FROM email_sync_streams WHERE link_id = '${linkId}' AND kind = 'folder_catalog'`
  );
  return rows[0]?.imports ?? '';
}

for (const provider of PROVIDERS) {
  test.describe(`forcing a sync of ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, Force sync in Settings starts nothing: an inbox that
    // fell behind cannot be read again from its provider.
    test('Force sync starts a new import of the inbox', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject: 'Lunch?',
        text: 'Noon at the quarry?',
      });
      await mailbox.synced('Lunch?');
      const before = await imports(mailbox);

      await mailbox.open('/app/mail/~/settings/email');
      await page
        .getByRole('button', { name: `Force sync ${mailbox.inbox.email}` })
        .click();
      did('AX-009');
      await expect(notice(page, 'Re-sync started')).toBeVisible();
      saw('STX-011');
      await expect.poll(() => imports(mailbox)).not.toBe(before);
      confirmed('F-023');
    });
  });
}
