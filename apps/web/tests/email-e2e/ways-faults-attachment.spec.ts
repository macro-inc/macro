// A received file's chip opening the file's Drive copy in a new split
// beside its thread. For a Gmail and an Outlook inbox.
//
// The email service files a received attachment into Drive through the
// storage service's internal create; in this stack its requests go to a
// stand-in that files nothing, so each test files the attachment through
// the real storage service with the same request (`fileIntoDrive`).

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { anInbox, PROVIDERS } from './harness/providers';
import { fileIntoDrive, type ReceivedFile } from './harness/ways-faults';
import { FROM, openFromList } from './harness/ways-thread';
import { did } from './ledger/record';

const NOTES: ReceivedFile = {
  filename: 'notes.txt',
  mimeType: 'text/plain',
  fileType: 'txt',
  text: 'Agenda: figures, then lunch.',
};

for (const provider of PROVIDERS) {
  test.describe(`a file chip of a message in ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, clicking a received file's chip does not open the
    // file's Drive copy beside the thread: no split opens, a different
    // document opens, or the thread is replaced.
    test('a file chip opens its Drive copy in a new split', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from: FROM,
        subject: 'Figures',
        text: 'The figures are attached.',
        attachments: [
          {
            filename: NOTES.filename,
            mimeType: NOTES.mimeType,
            base64: Buffer.from(NOTES.text).toString('base64'),
          },
        ],
      });
      const thread = await mailbox.synced('Figures');
      const copy = await fileIntoDrive(mailbox, thread.id, NOTES);
      await mailbox.open();
      await openFromList(page, thread.id, 'The figures are attached.');

      await page
        .getByRole('button', { name: NOTES.filename, exact: true })
        .click();
      did('AL-176');
      await expect(page).toHaveURL(
        new RegExp(`/app/mail/${thread.id}/~/drive/[^/]+/${copy}(?:[?#]|$)`)
      );
      await expect(page.getByText('The figures are attached.')).toBeVisible();
      await expect(page.getByText('notes', { exact: true })).toBeVisible();
    });
  });
}
