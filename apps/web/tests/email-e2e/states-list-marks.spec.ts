// What the list marks between and on its rows: the date headers that part
// rows of different days, and the paperclip on the row of a thread with an
// attachment. Each for a Gmail and an Outlook inbox.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { anInbox, PROVIDERS } from './harness/providers';
import { inboxTab } from './harness/states-list';
import { deliverAt } from './harness/sync';
import { expectRows, GRACE, PDF_FILE, row } from './harness/ways-list1';
import { saw } from './ledger/record';

const DAY = 24 * 3600_000;

for (const provider of PROVIDERS) {
  test.describe(`the marks in the list of ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, rows of different days run together with no date
    // header between them, or the row of a thread with an attachment has
    // no paperclip (or one shows on a thread without any).
    test('date headers part the days, and the paperclip marks the thread with an attachment', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from: GRACE,
        subject: 'Report',
        text: 'Attached.',
        attachments: [PDF_FILE],
      });
      await deliverAt(mailbox, {
        from: GRACE,
        subject: 'Lunch?',
        text: 'Noon?',
        date: new Date(Date.now() - DAY),
      });
      await deliverAt(mailbox, {
        from: GRACE,
        subject: 'Old times',
        text: 'Remember?',
        date: new Date(Date.now() - 400 * DAY),
      });
      const report = (await mailbox.synced('Report')).id;
      const lunch = (await mailbox.synced('Lunch?')).id;
      const old = (await mailbox.synced('Old times')).id;
      const list = page.getByRole('grid', { name: 'Email' });
      const header = (label: string) =>
        list.getByRole('gridcell', { name: label, exact: true });

      await mailbox.open();
      await inboxTab(page, 'Signal');
      await expectRows(page, [report, lunch, old]);
      // Today's rows lead without a header of their own.
      await expect(header('Yesterday')).toBeVisible();
      await expect(header('Older')).toBeVisible();
      await expect(header('Today')).toHaveCount(0);
      saw('STL-401');

      await expect(
        row(page, report).getByRole('img', { name: 'Has attachments' })
      ).toBeVisible();
      await expect(
        row(page, lunch).getByRole('img', { name: 'Has attachments' })
      ).toHaveCount(0);
      saw('STL-030');
    });
  });
}
