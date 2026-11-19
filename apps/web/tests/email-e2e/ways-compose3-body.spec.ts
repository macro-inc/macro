// What goes into the text of an email besides words: files pasted into a new
// email, a person mentioned in it, and a document mentioned in a reply.

import {
  body,
  composeNew,
  loadAppSteadily,
  relayUploads,
  routeDraftId,
} from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { readMailbox } from './harness/journeys';
import { notice, replyEditor } from './harness/send';
import {
  createDocument,
  linkShare,
  makePrivate,
} from './harness/ways-compose-more';
import { openComposer, sentCopy } from './harness/ways-compose1';
import {
  PIXEL,
  pasteFile,
  replyTo,
  send,
  stubStaticFiles,
} from './harness/ways-compose2';
import { did } from './ledger/record';

const GRACE = 'grace@example.com';

test.beforeEach(async ({ page }) => {
  await loadAppSteadily(page);
  await relayUploads(page);
});

for (const provider of ['GMAIL', 'OUTLOOK'] as const) {
  test.describe(`the text of a new email in ${provider === 'GMAIL' ? 'a Gmail' : 'an Outlook'} inbox`, () => {
    test.use({ provider });

    // When this fails, a picture pasted into a new email is not put in its
    // text, or a pasted video is not attached: the message the provider
    // sends shows no picture, or arrives without the clip.
    test('a picture pasted into a new email goes inside its text and a pasted video is attached', async ({
      page,
      mailbox,
    }) => {
      const uploads = stubStaticFiles(mailbox);
      const subject = 'Pasted things';
      await composeNew(page, mailbox, {
        to: GRACE,
        subject,
        body: 'The map and the clip:',
      });
      await routeDraftId(page);

      await pasteFile(body(page), {
        name: 'map.png',
        mimeType: 'image/png',
        base64: PIXEL,
      });
      did('AC-027', 'F-105');
      await expect(body(page).locator('img')).toHaveCount(1);
      await expect.poll(() => uploads).toHaveLength(1);

      await pasteFile(body(page), {
        name: 'clip.mp4',
        mimeType: 'video/mp4',
        base64: Buffer.from('a short clip').toString('base64'),
      });
      did('AC-027', 'F-122');
      await expect(
        page.getByRole('button', { name: 'Remove clip.mp4' })
      ).toBeVisible();
      await send(page);

      const sent = await sentCopy(mailbox, subject);
      expect(sent.html).toMatch(/<img[^>]+src="(cid:|https?:)/);
      expect(sent.html).not.toContain('blob:');
      expect(sent.attachments).toContain('clip.mp4');
    });

    // When this fails, a person mentioned with @ in a new email is not
    // copied: no notice, or the message the recipient gets has nobody in
    // Cc. The stack knows one person, the signed-in user, so they mention
    // themselves.
    test('a person mentioned in a new email is added to Cc', async ({
      page,
      mailbox,
    }) => {
      const subject = 'Copied by mention';
      const to = await openComposer(page, mailbox);
      await to.fill(GRACE);
      await to.press('Enter');
      await page.getByRole('textbox', { name: 'Subject' }).fill(subject);
      await body(page).click();
      await page.keyboard.type('Looping myself in. ');

      await page.keyboard.type('@ada');
      // People shows loading rows until the directory answers; Enter before
      // the person is listed picks nobody.
      await expect(
        page.locator('.menu-surface').getByTitle(mailbox.inbox.email)
      ).toBeVisible();
      await page.keyboard.press('Enter');
      did('AC-023', 'F-106');
      await expect(
        notice(page, `${mailbox.inbox.email} added to CC`)
      ).toBeVisible();
      await expect(
        body(page).getByRole('link', { name: '@ada' })
      ).toBeVisible();
      await send(page);

      // The writer copied themselves, so Outlook holds it twice: sent and
      // received. Each copy has them in Cc.
      const self = mailbox.inbox.email;
      await expect
        .poll(
          async () =>
            (await readMailbox(mailbox, self))
              .filter((message) => message.subject === subject)
              .map((message) => ({ to: message.to, cc: message.cc })),
          { message: 'the message the provider sent has nobody in Cc' }
        )
        .toContainEqual({ to: [GRACE], cc: [self] });
    });
  });
}

// Gmail only: who may open the document is the document service's, whatever
// the mailbox.
// When this fails, a document mentioned with @ in a reply stays private:
// the recipients get a link to a document they cannot open.
test('a document mentioned in a reply is made viewable by its link', async ({
  page,
  mailbox,
}) => {
  // A new document can be opened by its link; this one is made private.
  const documentId = await createDocument(mailbox, 'Harbour plan');
  await makePrivate(mailbox, documentId);
  expect((await linkShare(mailbox, documentId)).linkShare).toBeFalsy();
  await replyTo(page, mailbox, 'Plan');
  await replyEditor(page).click();
  await page.keyboard.type('The plan is in ');

  await page.keyboard.type('@Harbour');
  await expect(page.getByText('Harbour plan', { exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  did('AC-083', 'F-106');
  await expect(
    replyEditor(page).getByRole('link', { name: /Harbour plan/ })
  ).toBeVisible();
  await expect
    .poll(() => linkShare(mailbox, documentId), {
      message: 'the mentioned document is still private',
    })
    .toEqual({ linkShare: 'PUBLIC', linkShareAccessLevel: 'view' });
});
