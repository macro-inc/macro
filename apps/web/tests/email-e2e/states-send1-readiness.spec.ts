// What Send says when the message is not ready to go: a draft this device
// cannot read back to queue, a file not uploaded while the device is
// offline, once it is back online, and when this device cannot save the
// draft it would send; a large file still uploading to be shared as a link;
// a picture in the text still uploading.
//
// Gmail only: these refusals are the composer's own checks, made before
// anything reaches the mailbox, the same code whatever the mailbox.

import { Buffer } from 'node:buffer';
import type { Page } from '@playwright/test';
import {
  attach,
  body,
  composeNew,
  dropFile,
  loadAppSteadily,
  routeDraftId,
} from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { notice } from './harness/send';
import { draftStorage, hold, refuse } from './harness/states-send1';
import { PIXEL, stubStaticFiles } from './harness/ways-compose2';
import { saw } from './ledger/record';

/** A file one byte over what a Gmail inbox takes as attachments. */
const TOO_BIG = {
  name: 'survey.bin',
  mimeType: 'application/octet-stream',
  buffer: Buffer.alloc(18_000_001),
};

/** A new message to grace whose draft the service confirmed. */
async function trailNotes(page: Page, mailbox: Mailbox): Promise<void> {
  await composeNew(page, mailbox, {
    to: 'grace@example.com',
    subject: 'Trail notes',
    body: 'Notes attached.',
  });
  await routeDraftId(page);
}

function sendButton(page: Page) {
  return page.getByRole('button', { name: 'Send email' });
}

/**
 * Asks to send with the shortcut. The notices of earlier refusals stack over
 * the Send button, and a pointer resting on them keeps them open.
 */
async function sendByShortcut(page: Page): Promise<void> {
  await body(page).click();
  await page.keyboard.press('ControlOrMeta+Enter');
}

test.describe('what Send says when the message is not ready, Gmail inbox', () => {
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, Send of a message whose file did not upload, or whose
  // draft this device could not save or read back, says nothing or the
  // wrong reason: the user cannot tell to reconnect or to remove the file,
  // or believes the message went, or it goes out without the file.
  test('a draft not queued, a file not uploaded and a draft not saved hold Send and say why', async ({
    page,
    mailbox,
  }) => {
    const storage = await draftStorage(page);
    await trailNotes(page, mailbox);
    const send = sendButton(page);

    // The draft is saved, but this device cannot read its drafts back to
    // queue the send.
    await storage.failReads();
    await send.click();
    await expect(notice(page, /^Failed to send email$/)).toBeVisible();
    saw('STC-037');
    await storage.release();

    // Object storage refuses every upload of the file, as often as it is tried.
    const refusedUploads = await refuse(
      page,
      (request) => /\/email-attachments\//.test(request.url()),
      1_000
    );
    await attach(page, {
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('notes'),
    });
    await expect.poll(refusedUploads).toBeGreaterThan(0);

    await page.context().setOffline(true);
    await sendByShortcut(page);
    await expect(notice(page, 'Reconnect to send this email.')).toContainText(
      'Failed to send email'
    );
    saw('STC-033');

    await page.context().setOffline(false);
    await sendByShortcut(page);
    await expect(notice(page, 'Attachment not uploaded')).toContainText(
      'Failed to send email'
    );
    saw('STC-036');

    // This device can no longer save the draft it would send.
    await storage.failWrites();
    await sendByShortcut(page);
    await expect(notice(page, 'Draft not saved')).toContainText(
      'Failed to send email'
    );
    saw('STC-035');
    await storage.release();
  });

  // When this fails, Send while a file shared as a link or a picture in the
  // text is still uploading says nothing or the wrong reason, or the message
  // goes out without the link or the picture.
  test('a shared file or a picture still uploading holds Send and says why', async ({
    page,
    mailbox,
  }) => {
    stubStaticFiles(mailbox);
    await trailNotes(page, mailbox);
    const send = sendButton(page);

    // Too big to attach, so shared as a link; its upload is held.
    const documents = await hold(
      page,
      (request) =>
        request.method() === 'POST' &&
        new URL(request.url()).pathname.endsWith('/documents')
    );
    await attach(page, TOO_BIG);
    await page.getByRole('button', { name: 'Share link', exact: true }).click();
    await documents.arrived;
    // The button waits for the upload; the shortcut still asks to send.
    await expect(send).toBeDisabled();
    await sendByShortcut(page);
    await expect(notice(page, 'Files are still uploading')).toContainText(
      'Failed to send email'
    );
    saw('STC-403');

    // A picture dropped into the text, its upload held.
    const picture = await hold(
      page,
      (request) =>
        request.method() === 'PUT' &&
        new URL(request.url()).pathname.startsWith('/static-file/')
    );
    await dropFile(body(page), {
      name: 'map.png',
      mimeType: 'image/png',
      base64: PIXEL,
    });
    await expect(body(page).locator('img')).toHaveCount(1);
    await picture.arrived;
    await sendByShortcut(page);
    await expect(
      notice(
        page,
        'Wait for images and videos to finish uploading, or remove them.'
      )
    ).toContainText('Failed to send email');
    saw('STC-034');

    await picture.release();
    await documents.release();
  });
});
