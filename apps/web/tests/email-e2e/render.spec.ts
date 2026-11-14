// What a message's body shows: its pictures.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Page } from '@playwright/test';
import { expect, type Mailbox, test } from './harness/fixtures';
import { threadMessages } from './harness/thread';
import { did, saw } from './ledger/record';

/** A one-pixel PNG. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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

/**
 * Puts an HTML message in the Gmail mailbox with a remote picture, a picture
 * attached inline (`cid:`) and a picture embedded in the HTML (`data:`), and
 * returns the static-file id Macro gave the inline one.
 */
async function deliverPictures(
  mailbox: Mailbox,
  subject: string,
  remoteUrl: string
): Promise<{ threadId: string; inlineFileId: string }> {
  const html =
    '<p>Three pictures follow.</p>' +
    `<img alt="remote" width="40" height="20" src="${remoteUrl}">` +
    '<img alt="inline" width="40" height="20" src="cid:logo@example.com">' +
    `<img alt="embedded" width="40" height="20" src="data:image/png;base64,${PNG}">`;
  const raw = [
    'From: Grace <grace@example.com>',
    `To: ${mailbox.inbox.email}`,
    `Subject: ${subject}`,
    'Message-ID: <pictures@example.com>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/related; boundary="rel"',
    '',
    '--rel',
    'Content-Type: text/html; charset=utf-8',
    '',
    html,
    '--rel',
    'Content-Type: image/png; name="logo.png"',
    'Content-Transfer-Encoding: base64',
    'Content-ID: <logo@example.com>',
    'Content-Disposition: inline; filename="logo.png"',
    '',
    PNG,
    '--rel--',
    '',
  ].join('\r\n');
  const base = `${mailbox.stack.info.gmailUrl}/_emulator/mailboxes/${encodeURIComponent(
    mailbox.inbox.email
  )}`;
  const delivered = await fetch(`${base}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  if (!delivered.ok)
    throw new Error(`Gmail refused the message: ${delivered.status}`);
  const pushed = await fetch(`${base}/push`, { method: 'POST' });
  if (!pushed.ok)
    throw new Error(`Gmail did not announce it: ${pushed.status}`);

  const thread = await mailbox.synced(subject);
  const [message] = await threadMessages(mailbox, thread.id);
  const attachments = message.attachments as
    | { content_id: string | null; sfs_id: string | null }[]
    | undefined;
  const inline = attachments?.find((attachment) =>
    attachment.content_id?.includes('logo@example.com')
  );
  if (!inline?.sfs_id) throw new Error('the inline picture has no file id');
  return { threadId: thread.id, inlineFileId: inline.sfs_id };
}

/**
 * Stands in for the two services pictures load from, which the stack does not
 * run: the image proxy fetches the address it is given, and the static-file
 * service serves the one file it holds.
 */
async function servePictures(page: Page, inlineFileId: string): Promise<void> {
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
  await page.route(/\/static-file\/file\/[^/?]+/, async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop();
    if (id !== inlineFileId) return route.fulfill({ status: 404 });
    await route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(PNG, 'base64'),
    });
  });
}

/** Checks that let the test go on, so one run shows every broken picture. */
const soft = expect.configure({ soft: true });

/** The width of the decoded picture; 0 while it has not loaded or is broken. */
function loadedWidth(page: Page, alt: string): Promise<number> {
  return page
    .locator(`[data-message-body-id] img[alt="${alt}"]`)
    .evaluateAll(
      (images) => (images[0] as HTMLImageElement | undefined)?.naturalWidth ?? 0
    );
}

test.describe("a message's pictures", () => {
  // Class render-remote-images-not-loading: when this fails, a picture of the
  // message shows as broken: the remote one is not fetched (or not through the
  // image proxy), or the `cid:` reference of the inline one is left unresolved.
  test('remote and inline pictures load', async ({ page, mailbox }) => {
    const pictures = await pictureServer();
    try {
      const { threadId, inlineFileId } = await deliverPictures(
        mailbox,
        'Two pictures',
        pictures.url
      );
      await servePictures(page, inlineFileId);
      await mailbox.open(`/app/mail/${threadId}`);
      did('AL-910');
      await expect(page.getByText('Three pictures follow.')).toBeVisible();

      await soft(
        page.locator('[data-message-body-id] img[alt="inline"]')
      ).toHaveAttribute(
        'src',
        new RegExp(`/static-file/file/${inlineFileId}$`)
      );
      await soft.poll(() => loadedWidth(page, 'inline')).toBeGreaterThan(0);
      saw('STL-906');
      await soft.poll(() => loadedWidth(page, 'remote')).toBeGreaterThan(0);
      soft(pictures.asked).toContain('/banner.png');
    } finally {
      pictures.server.close();
    }
  });

  // Class render-remote-images-not-loading: when this fails, a picture embedded
  // in the HTML as a `data:` address shows as broken. Today the email service
  // serves the body with that picture's `src` removed.
  test('known bug: render-remote-images-not-loading: a picture embedded in the HTML loads', {
    tag: '@known-bug',
  }, async ({ page, mailbox }) => {
    const pictures = await pictureServer();
    try {
      const { threadId, inlineFileId } = await deliverPictures(
        mailbox,
        'Embedded picture',
        pictures.url
      );
      await servePictures(page, inlineFileId);
      await mailbox.open(`/app/mail/${threadId}`);
      did('AL-910');
      await expect(page.getByText('Three pictures follow.')).toBeVisible();
      // The remote picture has loaded by then, so the page had its time.
      await expect.poll(() => loadedWidth(page, 'remote')).toBeGreaterThan(0);
      await expect.poll(() => loadedWidth(page, 'embedded')).toBeGreaterThan(0);
      saw('STL-906');
    } finally {
      pictures.server.close();
    }
  });
});
