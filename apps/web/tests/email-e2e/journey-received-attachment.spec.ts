// Journey: files that arrived by mail. The thread lists them, and downloading
// one saves the bytes that were sent. The same journey for a Gmail and an
// Outlook inbox.

import { readFile } from 'node:fs/promises';
import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import type { Provider } from './harness/stack';
import { did, saw } from './ledger/record';

const PROVIDERS: Provider[] = ['GMAIL', 'OUTLOOK'];

// Bytes that a text decoder or a line-ending change would alter.
const REPORT = Buffer.concat([
  Buffer.from('%PDF-1.4\n'),
  Buffer.from([0x00, 0xff, 0x0d, 0x0a, 0x80, 0x7f]),
  Buffer.from('\nquarterly figures\r\n'),
]);

for (const provider of PROVIDERS) {
  test.describe(`a received attachment in ${provider === 'GMAIL' ? 'a Gmail' : 'an Outlook'} inbox`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a received file is missing from its thread, or the
    // download saves different bytes from those that were sent.
    test('is listed in its thread and downloads with the bytes that were sent', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject: 'Figures',
        text: 'The figures are attached.',
        attachments: [
          {
            filename: 'notes.txt',
            mimeType: 'text/plain',
            base64: Buffer.from('Agenda: figures, then lunch.').toString(
              'base64'
            ),
          },
          {
            filename: 'figures.bin',
            mimeType: 'application/octet-stream',
            base64: REPORT.toString('base64'),
          },
        ],
      });
      const thread = await mailbox.synced('Figures');
      // The stored copy lives in the stack's object storage, which answers
      // no CORS headers: the test process fetches it for the page.
      const app = new URL(mailbox.front.origin).origin;
      await page.route(
        (url) => url.origin !== app,
        async (route) => {
          if (route.request().resourceType() !== 'fetch') {
            return route.fallback();
          }
          const response = await route.fetch();
          await route.fulfill({
            response,
            headers: {
              ...response.headers(),
              'access-control-allow-origin': '*',
            },
          });
        }
      );

      await mailbox.open(`/app/mail/${thread.id}`);
      did('AL-910');
      await expect(page.getByText('The figures are attached.')).toBeVisible();
      saw('STL-951');
      saw('STL-906');
      const notes = page.getByRole('button', {
        name: 'notes.txt',
        exact: true,
      });
      const figures = page.getByRole('button', {
        name: 'figures.bin',
        exact: true,
      });
      await expect(notes).toBeVisible();
      await expect(figures).toBeVisible();
      saw('STL-512');

      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download figures.bin' }).click();
      did('AL-177');
      const download = await downloading;
      expect(download.suggestedFilename()).toBe('figures.bin');
      const saved = await readFile(await download.path());
      expect(saved.equals(REPORT)).toBe(true);
    });
  });
}
