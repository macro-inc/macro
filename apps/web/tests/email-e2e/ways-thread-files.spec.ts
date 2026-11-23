// The chips of a calendar file attached to a received message: the chip
// downloads the file when the message shows no event, and the event
// preview offers its own "Download .ics". For a Gmail and an Outlook inbox.
// (A file chip opening its Drive copy: ways-faults-attachment.spec.ts.)

import { readFile } from 'node:fs/promises';
import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { anInbox, PROVIDERS } from './harness/providers';
import {
  calendarFile,
  deliverCalendarFile,
  FROM,
  openFromList,
  relayStorage,
} from './harness/ways-thread';
import { did } from './ledger/record';

/** A calendar file with no event in it: nothing for the message to show. */
const EMPTY_CALENDAR = [
  'BEGIN:VCALENDAR',
  'PRODID:-//Example//Calendar//EN',
  'VERSION:2.0',
  'END:VCALENDAR',
  '',
].join('\r\n');
const WALK = calendarFile({
  uid: 'harbour-walk-2@example.com',
  summary: 'Harbour walk',
  method: 'PUBLISH',
});

for (const provider of PROVIDERS) {
  test.describe(`the attachment chips of a message in ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a calendar file with no event to show cannot be
    // downloaded from its chip, or the event preview's Download .ics saves
    // nothing or other bytes.
    test('a calendar file downloads from its chip and from its preview', async ({
      page,
      mailbox,
    }) => {
      const walk = await deliverCalendarFile(
        mailbox,
        { subject: 'Harbour walk', text: 'The event is attached.' },
        { filename: 'walk.ics', ics: WALK }
      );
      await mailbox.deliver({
        from: FROM,
        subject: 'Calendar export',
        text: 'My calendar is attached.',
        attachments: [
          {
            filename: 'empty.ics',
            mimeType: 'text/calendar',
            base64: Buffer.from(EMPTY_CALENDAR).toString('base64'),
          },
        ],
      });
      const exported = await mailbox.synced('Calendar export');
      await relayStorage(page, mailbox);
      await mailbox.open();
      const back = page.getByRole('button', { name: 'Back', exact: true });

      // A calendar file the message shows no event for is only a file.
      await openFromList(page, exported.id, 'My calendar is attached.');
      const exporting = page.waitForEvent('download');
      await page
        .getByRole('button', { name: 'empty.ics', exact: true })
        .click();
      did('AL-508');
      const exportedFile = await exporting;
      expect(exportedFile.suggestedFilename()).toBe('empty.ics');
      expect((await readFile(await exportedFile.path())).toString()).toBe(
        EMPTY_CALENDAR
      );
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await back.click();
      await expect(page).toHaveURL(/\/app\/mail$/);

      // One that is an event opens as the event, which offers the file.
      await openFromList(page, walk, 'Harbour walk');
      await page.getByText('walk.ics').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('Harbour walk');
      const downloading = page.waitForEvent('download');
      await dialog.getByRole('button', { name: 'Download .ics' }).click();
      did('AL-510');
      const download = await downloading;
      expect(download.suggestedFilename()).toBe('walk.ics');
      expect((await readFile(await download.path())).toString()).toBe(WALK);
    });
  });
}
