// A new message, piece by piece: opening the composer, leaving the signature
// out, a link and a picture in the body, and the inbox it is sent from. Each
// for a Gmail and an Outlook inbox.

import {
  body,
  composeNew,
  loadAppSteadily,
  routeDraftId,
  watchDraftSaves,
} from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { type ReadMessage, readMailbox } from './harness/journeys';
import { notice } from './harness/send';
import type { Provider } from './harness/stack';
import { confirmed, did, saw } from './ledger/record';

/** A 1x1 PNG. */
const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** The one message `email` sent with this subject, as the provider holds it. */
async function sentCopy(
  mailbox: Mailbox,
  subject: string,
  email: string = mailbox.inbox.email
): Promise<ReadMessage> {
  const sent = async () =>
    (await readMailbox(mailbox, email)).filter(
      (message) => message.subject === subject && message.from === email
    );
  await expect
    .poll(async () => (await sent()).length, {
      message: `the provider never received "${subject}"`,
      timeout: 30_000,
    })
    .toBe(1);
  return (await sent())[0];
}

const PROVIDERS: Provider[] = ['GMAIL', 'OUTLOOK'];

for (const provider of PROVIDERS) {
  test.describe(`a new message, ${provider === 'GMAIL' ? 'a Gmail' : 'an Outlook'} inbox`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, New email does nothing, or opens a composer that
    // still holds another message.
    test('New email in the sidebar opens an empty composer', async ({
      page,
      mailbox,
    }) => {
      await mailbox.open('/app/mail');
      await page
        .getByRole('complementary', { name: 'Email navigation' })
        .getByLabel('New email')
        .click();
      did('AL-010');
      await expect(page.getByRole('textbox', { name: 'Subject' })).toHaveValue(
        ''
      );
      await expect(page.getByRole('combobox').first()).toHaveValue('');
      await expect(page.getByRole('link', { name: /@/ })).toHaveCount(0);
      await expect(body(page)).toHaveText('');
      await expect(
        page.getByRole('button', { name: 'Send email' })
      ).toBeVisible();
      saw('STL-931');
    });

    // When this fails, a message goes out with the signature its sender
    // took off.
    test('a message sent after "Don\'t include signature" carries no signature', async ({
      page,
      mailbox,
    }) => {
      const saved = await mailbox.api('/email/email/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          settings: { signature: '<p>Ada Lovelace, Analytical Engines</p>' },
        }),
      });
      expect(saved.ok).toBe(true);

      await composeNew(page, mailbox, {
        to: 'bob@example.com',
        subject: 'Short note',
        body: 'No signature on this one.',
      });
      const signature = page.getByRole('button', {
        name: 'Signature',
        exact: true,
      });
      await expect(signature).toBeVisible();
      saw('STC-092');
      await expect(signature).toHaveAttribute('aria-expanded', 'false');
      saw('STC-311');
      await page
        .getByRole('button', { name: "Don't include signature" })
        .click();
      did('AC-069');
      await expect(signature).toHaveCount(0);
      saw('STC-972');
      await page.getByRole('button', { name: 'Send email' }).click();
      did('AC-057');
      await expect(notice(page, 'Email sent')).toBeVisible();
      saw('STC-025');

      const sent = await sentCopy(mailbox, 'Short note');
      expect(sent.html).toContain('No signature on this one.');
      expect(sent.html).not.toContain('Analytical Engines');
      confirmed('F-107');
    });

    // When this fails, an address typed into the body stays plain text in
    // the composer, or reaches the recipient as text that cannot be clicked.
    test('a typed address is a link in the body and in the message', async ({
      page,
      mailbox,
    }) => {
      await composeNew(page, mailbox, {
        to: 'bob@example.com',
        subject: 'The plan',
        body: 'Read this: ',
      });
      await body(page).pressSequentially('https://example.com/plan ');
      did('AC-042');
      await expect(body(page).getByRole('link')).toHaveAttribute(
        'href',
        'https://example.com/plan'
      );
      saw('STC-935');
      await page.getByRole('button', { name: 'Send email' }).click();
      did('AC-057');
      await expect(notice(page, 'Email sent')).toBeVisible();
      saw('STC-025');

      const sent = await sentCopy(mailbox, 'The plan');
      expect(sent.html).toMatch(
        /<a\s[^>]*href="https:\/\/example\.com\/plan"[^>]*>/
      );
      confirmed('F-104');
    });

    // When this fails, Insert image puts nothing in the text, or the
    // message goes out without the picture where the sender put it.
    test('a picture inserted from the toolbar is sent inside the message', async ({
      page,
      mailbox,
    }) => {
      // The static file service, which the stack does not run: it names the
      // image and says where to upload it and where it will be served.
      const uploads: string[] = [];
      mailbox.front.stub(({ method, path }) => {
        if (method !== 'PUT') return undefined;
        if (path === '/static-file/api/file') {
          const location = `${mailbox.front.origin}/static-file/stored/map-1`;
          return {
            json: {
              id: 'map-1',
              upload_url: location,
              file_location: location,
            },
          };
        }
        if (path === '/static-file/stored/map-1') {
          uploads.push(path);
          return { json: {} };
        }
        return undefined;
      });
      await composeNew(page, mailbox, {
        to: 'bob@example.com',
        subject: 'Harbour walk',
        body: 'The map:',
      });
      await routeDraftId(page);

      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Insert image' }).click();
      await (await chooser).setFiles({
        name: 'map.png',
        mimeType: 'image/png',
        buffer: Buffer.from(PIXEL, 'base64'),
      });
      did('AC-028');
      await expect(body(page).getByRole('img')).toHaveCount(1);
      saw('STC-936');
      await expect.poll(() => uploads).toHaveLength(1);
      await page.getByRole('button', { name: 'Send email' }).click();
      did('AC-057');
      await expect(notice(page, 'Email sent')).toBeVisible();
      saw('STC-025');

      const sent = await sentCopy(mailbox, 'Harbour walk');
      // The picture itself, at the address it was stored under: the pixel
      // of a read receipt is an image too.
      expect(sent.html).toMatch(
        /<img[^>]+src="(cid:|https?:)[^"]*"[^>]*data-image-id="map-1"/
      );
      expect(sent.html).not.toContain('blob:');
      confirmed('F-105');
    });

    // When this fails, a message leaves from the inbox the composer opened
    // with, not the one its sender chose in From.
    //
    // On Outlook the choice is sometimes dropped (about one run in eight):
    // choosing makes the composer save the draft and ask for the move right
    // after, and the service refuses a move while that save is not yet at
    // Outlook. From shows the first inbox again. Nothing on screen tells
    // when the choice would hold, so there is nothing to wait for.
    test(`${provider === 'OUTLOOK' ? 'known bug: outlook-from-choice-dropped-while-draft-syncs: ' : ''}a message is sent from the inbox chosen in From`, {
      tag: provider === 'OUTLOOK' ? '@known-bug' : [],
    }, async ({ page, mailbox }) => {
      const work = await mailbox.stack.link(
        mailbox.user,
        provider,
        'ada.work@example.com'
      );
      const saves = watchDraftSaves(page);
      await composeNew(page, mailbox, {
        to: 'bob@example.com',
        subject: 'Quarterly numbers',
        body: 'Numbers are in.',
      });
      const original = await routeDraftId(page);
      // An Outlook draft moves only once Outlook holds every save of it:
      // until then the service refuses the move and asks to wait.
      await expect
        .poll(() => saves.some((save) => save.html.includes('Numbers are in.')))
        .toBe(true);
      if (provider === 'OUTLOOK') {
        await expect
          .poll(
            async () => {
              const answer = await mailbox.api(
                `/email/email/drafts/${original}/operation`
              );
              const { operation } = (await answer.json()) as {
                operation?: { state?: string; revision?: string } | null;
              };
              return (
                operation?.state === 'SYNCHRONIZED' &&
                Number(operation.revision) >= saves.length
              );
            },
            { timeout: 30_000 }
          )
          .toBe(true);
      }

      const from = page.getByRole('button', { name: 'From address' });
      await expect(from).toContainText(mailbox.inbox.email);
      await from.click();
      const choices = page.getByRole('menuitem');
      await expect(choices).toHaveCount(2);
      await expect(
        choices.filter({ hasText: mailbox.inbox.email })
      ).toHaveCount(1);
      saw('STC-307', 'F-100');
      await choices.filter({ hasText: work.email }).click();
      did('AC-020');
      await expect(from).toContainText(work.email);
      saw('STC-960');
      // The move gives the draft a new id in the other inbox; the route follows.
      await expect
        .poll(() =>
          new URL(page.url()).searchParams.get('s0.email-compose.draft')
        )
        .not.toBe(original);
      await routeDraftId(page);
      await page.getByRole('button', { name: 'Send email' }).click();
      did('AC-057');

      const sent = await sentCopy(mailbox, 'Quarterly numbers', work.email);
      expect(sent.from).toBe(work.email);
      expect(sent.html).toContain('Numbers are in.');
      // Nothing left from the inbox the composer opened with.
      expect(
        (await readMailbox(mailbox, mailbox.inbox.email)).filter(
          (message) => message.subject === 'Quarterly numbers'
        )
      ).toEqual([]);
      confirmed('F-100');
    });
  });
}
