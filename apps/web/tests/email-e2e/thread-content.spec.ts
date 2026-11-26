// What a thread gives beyond its text: a message saved as an .eml file, the
// read receipt of a sent message, and remote pictures fetched through the
// image proxy. For a Gmail and an Outlook inbox.

import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Page } from '@playwright/test';
import { composeNew, loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { addMailbox, readMailbox } from './harness/journeys';
import { anInbox, PROVIDERS } from './harness/providers';
import { notice } from './harness/send';
import { messageCard, threadMessages } from './harness/thread';
import { confirmed, did, saw } from './ledger/record';

/** A one-pixel PNG. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const SUBJECT = 'Committee: minutes?';

/** Delivers the committee's message and opens its thread. */
async function openCommittee(page: Page, mailbox: Mailbox): Promise<string> {
  await mailbox.deliver({
    from: 'Grace Hopper <grace@example.com>',
    subject: SUBJECT,
    text: 'The committee meets on Tuesday.',
    messageId: 'committee-1@example.com',
  });
  const thread = await mailbox.synced(SUBJECT);
  await mailbox.open(`/app/mail/${thread.id}`);
  did('AL-910');
  await expect(
    messageCard(page, 'The committee meets on Tuesday.')
  ).toBeVisible();
  return thread.id;
}

/** Chooses Download .eml in the menu of the thread's title. */
async function chooseDownload(page: Page): Promise<void> {
  await page
    .getByRole('heading', { name: SUBJECT })
    .getByRole('button')
    .click();
  await page.getByRole('menuitem', { name: 'Download .eml' }).click();
  did('AL-156');
}

/** A web server with one picture, and the paths it was asked for. */
async function pictureServer(): Promise<{
  server: Server;
  url: string;
  asked: string[];
}> {
  const asked: string[] = [];
  const server = createServer((request, response) => {
    asked.push(request.url ?? '');
    response.writeHead(200, { 'content-type': 'image/png' });
    response.end(Buffer.from(PNG, 'base64'));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}/banner.png`, asked };
}

for (const provider of PROVIDERS) {
  test.describe(`the content of a thread in ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, Download .eml in a thread's title menu saves no file,
    // names it wrongly, or saves something other than the source of the
    // message that the email service holds.
    test('a message downloads as an .eml file', async ({ page, mailbox }) => {
      const threadId = await openCommittee(page, mailbox);
      const downloading = page.waitForEvent('download');
      await chooseDownload(page);
      const download = await downloading;
      // The characters a file name cannot hold are dropped from the subject.
      expect(download.suggestedFilename()).toBe('Committee minutes.eml');
      const saved = await readFile(await download.path());
      const source = saved.toString('utf8');
      expect(source).toContain(`Subject: ${SUBJECT}`);
      expect(source).toContain('Message-ID: <committee-1@example.com>');
      expect(source).toContain('The committee meets on Tuesday.');
      saw('STL-981');

      const [message] = await threadMessages(mailbox, threadId);
      const answer = await mailbox.api(
        `/email/email/messages/${message.db_id}/eml`
      );
      expect(answer.status).toBe(200);
      expect(Buffer.from(await answer.arrayBuffer()).equals(saved)).toBe(true);
      confirmed('F-064');
    });

    // When this fails, a download the email service refuses ends in silence:
    // no file and no word to the user.
    test('a failed .eml download says so', async ({ page, mailbox }) => {
      await openCommittee(page, mailbox);
      await page.route(/\/messages\/[^/]+\/eml(?:\?|$)/, (route) =>
        route.fulfill({ status: 500, body: 'refused' })
      );
      await chooseDownload(page);
      await expect(
        notice(page, 'Failed to download email. Please try again.')
      ).toBeVisible();
      saw('STL-094');
    });

    // When this fails, a sent message does not say whether its recipient has
    // opened it: it carries no tracking picture, the service does not count
    // the picture being fetched, or the message keeps saying "Not opened".
    test('a sent message shows whether it was opened', async ({
      page,
      mailbox,
    }) => {
      const grace = 'grace@example.com';
      await addMailbox(mailbox, grace);
      await composeNew(page, mailbox, {
        to: grace,
        subject: 'Quarterly figures',
        body: 'The figures are ready.',
      });
      await page.getByRole('button', { name: 'Send email' }).click();
      await expect(notice(page, 'Email sent')).toBeVisible();
      await expect
        .poll(async () => (await readMailbox(mailbox, grace)).length)
        .toBe(1);
      const [received] = await readMailbox(mailbox, grace);
      const token = /\/opens\/([\w-]{20,})/.exec(received.html ?? '')?.[1];
      expect(token, 'the sent message carries a tracking picture').toBeTruthy();

      const thread = await mailbox.synced('Quarterly figures');
      const opens = async (): Promise<number[]> => {
        const answer = await mailbox.api(
          `/email/email/threads/${thread.id}/read-receipts`
        );
        const { receipts } = (await answer.json()) as {
          receipts: { open_count: number }[];
        };
        return receipts.map((receipt) => receipt.open_count);
      };
      await expect.poll(opens).toEqual([0]);
      await mailbox.open(`/app/mail/${thread.id}`);
      did('AL-910');
      const sent = messageCard(page, 'The figures are ready.');
      await expect(sent.getByText('Not opened')).toBeVisible();

      // The recipient's mail client fetches the picture as it shows the mail.
      const picture = await fetch(
        `${mailbox.stack.info.emailUrl}/opens/${token}`
      );
      expect(picture.status).toBe(200);
      expect(picture.headers.get('content-type')).toContain('image/');
      await expect.poll(opens).toEqual([1]);
      confirmed('F-066');

      await page.reload();
      await expect(sent.getByText('Opened', { exact: true })).toBeVisible();
      await expect(sent.getByText('Not opened')).toHaveCount(0);
      saw('STL-088');
    });

    // When this fails, the app fetches a message's remote picture from its
    // own host (telling the sender who opened the mail and when) instead of
    // asking the image proxy for it, or does not show the picture at all.
    // The stack does not run the image proxy: the test answers in its place,
    // so this proves the app's half of the function only.
    test('a remote picture is asked of the image proxy, not of its host', async ({
      page,
      mailbox,
    }) => {
      const pictures = await pictureServer();
      try {
        const asked: string[] = [];
        page.on('request', (request) => asked.push(request.url()));
        await page.route(/\/image-proxy\/proxy\?/, async (route) => {
          const target = new URL(route.request().url()).searchParams.get('url');
          if (!target) return route.fulfill({ status: 400 });
          const upstream = await fetch(target);
          await route.fulfill({
            status: upstream.status,
            contentType: upstream.headers.get('content-type') ?? undefined,
            body: Buffer.from(await upstream.arrayBuffer()),
          });
        });
        await mailbox.deliver({
          from: 'Grace Hopper <grace@example.com>',
          subject: 'Banner',
          html: `<p>A banner follows.</p><img alt="banner" width="40" height="20" src="${pictures.url}">`,
        });
        const thread = await mailbox.synced('Banner');
        await mailbox.open(`/app/mail/${thread.id}`);
        did('AL-910');
        await expect(page.getByText('A banner follows.')).toBeVisible();
        await expect
          .poll(() =>
            page
              .locator('[data-message-body-id] img[alt="banner"]')
              .evaluateAll(
                (images) =>
                  (images[0] as HTMLImageElement | undefined)?.naturalWidth ?? 0
              )
          )
          .toBeGreaterThan(0);
        const viaProxy = asked.filter((url) => url.includes('/image-proxy/'));
        expect(viaProxy.length).toBeGreaterThan(0);
        for (const url of viaProxy) {
          expect(new URL(url).pathname).toMatch(/\/image-proxy\/proxy$/);
          expect(new URL(url).searchParams.get('url')).toBe(pictures.url);
        }
        // The browser itself never asked the picture's host; the stand-in
        // for the proxy did.
        expect(asked.filter((url) => url.startsWith(pictures.url))).toEqual([]);
        expect(pictures.asked).toContain('/banner.png');
        saw('STL-907');
      } finally {
        pictures.server.close();
      }
    });
  });
}
