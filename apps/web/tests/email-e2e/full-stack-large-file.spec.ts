// A file too large to attach, on the local stack: the app uploads it to
// Macro, puts a view-only link in the message, and the recipient's copy
// carries the link to a document the storage service holds.

import { attach, composeNew, loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { addMailbox, readMailbox } from './harness/journeys';
import { anInbox, PROVIDERS } from './harness/providers';
import { notice } from './harness/send';
import { confirmed, did, saw } from './ledger/record';

const ZED = 'zed@example.com';

for (const provider of PROVIDERS) {
  test.describe(`a file too large to attach, from ${anInbox(provider)}`, {
    tag: '@full-stack',
  }, () => {
    test.use({ provider });
    test.beforeEach(async ({ page }) => {
      await loadAppSteadily(page);
      // The upload is tens of megabytes sent to the storage of the stack, and
      // a change of the machine's network (another container starting)
      // makes Chrome drop it mid-way. The test process carries it instead;
      // no such change reaches it.
      await page.route(
        (url) => url.pathname.startsWith('/local-storage/'),
        async (route) => {
          if (route.request().method() !== 'PUT') return route.fallback();
          const response = await route.fetch();
          await route.fulfill({ response });
        }
      );
    });

    // When this fails, a file over the provider's limit cannot be sent at
    // all: the upload to Macro fails, the link is not put into the message,
    // or the recipient gets a link to nothing.
    test('is uploaded to Macro and sent as a link the recipient can open', async ({
      page,
      mailbox,
    }) => {
      // The upload and the service's Undo hold each take a minute at worst.
      test.slow();
      const zed = await addMailbox(mailbox, ZED);
      await composeNew(page, mailbox, {
        to: zed,
        subject: 'Survey',
        body: 'The survey is too big to attach.',
      });
      const megabytes = provider === 'GMAIL' ? 18 : 25;
      await attach(page, {
        name: 'survey.txt',
        mimeType: 'text/plain',
        buffer: Buffer.alloc(megabytes * 1_000_000 + 1, 'a'),
      });
      const offer = page.getByRole('dialog');
      await expect(
        offer.getByText(`Attachments exceed ${megabytes} MB`)
      ).toBeVisible();
      saw('STC-021');
      await offer.getByRole('button', { name: 'Share link' }).click();
      did('AC-071');
      // The notice shows for a few seconds: watch for it while the dialog
      // closes, not after.
      await Promise.all([
        expect(offer).toBeHidden({ timeout: 60_000 }),
        expect(notice(page, 'Recipients can now view this file')).toBeVisible({
          timeout: 60_000,
        }),
      ]);
      saw('STC-019', 'F-125');
      await expect(
        page
          .getByRole('textbox', { name: /reference files/ })
          .getByRole('link', { name: 'survey.txt' })
      ).toBeVisible();

      await page.getByRole('button', { name: 'Send email' }).click();
      // The notice comes when the service has delivered the message, after
      // the time it holds a send for Undo: on a busy stack, over 20 seconds.
      await expect(notice(page, 'Email sent')).toBeVisible({
        timeout: 90_000,
      });
      const received = async () =>
        (await readMailbox(mailbox, zed)).filter(
          (message) => message.subject === 'Survey'
        );
      await expect.poll(async () => (await received()).length).toBe(1);
      const [message] = await received();
      const id = /data-document-id="([^"]+)"/.exec(message.html ?? '')?.[1];
      expect(id).toBeTruthy();
      // What the link leads to: a stored document anyone with the link may view.
      const stored = await mailbox.api(`/dss/documents/${id}`);
      expect(stored.status).toBe(200);
      const { data } = (await stored.json()) as {
        data: {
          documentMetadata: {
            documentName: string;
            content: { state: string };
          };
        };
      };
      expect(data.documentMetadata.documentName).toBe('survey');
      expect(data.documentMetadata.content.state).toBe('ready');
      const access = await mailbox.api(`/dss/documents/${id}/permissions`);
      expect(access.status).toBe(200);
      expect(
        (
          (await access.json()) as {
            documentPermissions: {
              linkShare: string;
              linkShareAccessLevel: string;
            };
          }
        ).documentPermissions
      ).toMatchObject({ linkShare: 'PUBLIC', linkShareAccessLevel: 'view' });
      confirmed('F-125');
    });
  });
}
