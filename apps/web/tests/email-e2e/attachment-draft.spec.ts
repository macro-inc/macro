// Attachments of a message being written: taking one off again, opening one,
// and a file too large to attach offered as a link. And the cloud attachments
// of an Outlook message, which are links to the provider's storage.

import type { Page } from '@playwright/test';
import {
  attach,
  composeNew,
  loadAppSteadily,
  relayUploads,
  routeDraftId,
} from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { addMailbox, readMailbox } from './harness/journeys';
import { PROVIDERS } from './harness/providers';
import { onlySentRaw, replyEditor } from './harness/send';
import { storedAttachment } from './harness/thread';
import { confirmed, did, saw } from './ledger/record';

const ZED = 'zed@example.com';

const NOTES = {
  name: 'notes.txt',
  mimeType: 'text/plain',
  buffer: Buffer.from('bring the map'),
};

const ROUTE = {
  name: 'route.txt',
  mimeType: 'text/plain',
  buffer: Buffer.from('north ridge, then the ford'),
};

/** A picture of one pixel. */
const PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

/** Where the cloud attachment of the Outlook message lives. */
const CLOUD_FILE = 'https://files.example/shared/deck.pptx';

/**
 * Lets the page read and show what the stack's object storage answers: it
 * sends no CORS or resource-policy headers, which the isolated page needs
 * from another origin, so the test process fetches for the page.
 */
async function relayStorage(page: Page, mailbox: Mailbox): Promise<void> {
  const app = new URL(mailbox.front.origin).origin;
  await page.route(
    (url) => url.origin !== app,
    async (route) => {
      if (!['fetch', 'xhr', 'image'].includes(route.request().resourceType()))
        return route.fallback();
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          'access-control-allow-origin': '*',
          'access-control-expose-headers': '*',
          'cross-origin-resource-policy': 'cross-origin',
        },
      });
    }
  );
}

/** Counts the answers the email service gives that match, from now on. */
function countAnswers(page: Page, method: string, path: RegExp) {
  const seen = { count: 0 };
  page.on('response', (response) => {
    if (
      response.ok() &&
      response.request().method() === method &&
      path.test(new URL(response.url()).pathname)
    )
      seen.count += 1;
  });
  return seen;
}

/** The bytes behind the address a picture on the page shows, in base64. */
function pictureBytes(page: Page, address: string): Promise<string> {
  return page.evaluate(async (url) => {
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }, address);
}

test.beforeEach(({ page }) => loadAppSteadily(page));

for (const provider of PROVIDERS) {
  const inbox = provider === 'GMAIL' ? 'a Gmail' : 'an Outlook';

  test.describe(`attachments of a draft in ${inbox} inbox`, () => {
    test.use({ provider });

    test('a file taken off a new message is not sent', async ({
      page,
      mailbox,
    }) => {
      await addMailbox(mailbox, ZED);
      await relayUploads(page);
      const stored = countAnswers(
        page,
        'POST',
        /\/attachments\/[^/]+\/complete$/
      );
      const dropped = countAnswers(page, 'DELETE', /\/attachments\/[^/]+$/);
      await composeNew(page, mailbox, {
        to: ZED,
        subject: 'Trail notes',
        body: 'Notes attached.',
      });
      await routeDraftId(page);
      await attach(page, NOTES);
      await attach(page, ROUTE);
      const removeNotes = page.getByRole('button', {
        name: 'Remove notes.txt',
      });
      await expect(removeNotes).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Remove route.txt' })
      ).toBeVisible();
      // Both files are with the draft Macro holds before one is taken off.
      await expect.poll(() => stored.count).toBe(2);

      await removeNotes.click();
      did('AC-029');
      await expect(removeNotes).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: 'Remove route.txt' })
      ).toBeVisible();
      saw('STC-978');
      await expect.poll(() => dropped.count).toBe(1);

      await page.getByRole('button', { name: 'Send email' }).click();
      const raw = await onlySentRaw(mailbox);
      expect(raw).toContain('filename="route.txt"');
      expect(raw).toContain(ROUTE.buffer.toString());
      expect(raw).not.toContain('notes.txt');
      expect(raw).not.toContain(NOTES.buffer.toString());
      confirmed('F-123');
    });

    test('a forwarded picture opens from its pill and a forwarded file taken off is not sent', async ({
      page,
      mailbox,
    }) => {
      await addMailbox(mailbox, ZED);
      await relayStorage(page, mailbox);
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject: 'Harbour',
        text: 'The picture and the menu.',
        attachments: [
          {
            filename: 'photo.png',
            mimeType: 'image/png',
            base64: PHOTO.toString('base64'),
          },
          {
            filename: 'menu.txt',
            mimeType: 'text/plain',
            base64: Buffer.from('soup of the day').toString('base64'),
          },
        ],
      });
      const thread = await mailbox.synced('Harbour');
      await mailbox.open(`/app/mail/${thread.id}`);
      await page.getByText('The picture and the menu.').first().hover();
      await page.getByRole('button', { name: 'Forward', exact: true }).click();
      const removePhoto = page.getByRole('button', {
        name: 'Remove photo.png',
      });
      const removeMenu = page.getByRole('button', { name: 'Remove menu.txt' });
      await expect(removePhoto).toBeVisible();
      await expect(removeMenu).toBeVisible();
      await page.getByRole('combobox').fill(ZED);
      await page.keyboard.press('Enter');
      await replyEditor(page).click();
      await replyEditor(page).pressSequentially('For the weekend.');

      // The pill of the picture is the button beside its Remove button.
      await removePhoto
        .locator('xpath=..')
        .getByRole('button', { name: 'photo.png', exact: true })
        .click();
      did('AC-088');
      const viewer = page.getByRole('dialog');
      const picture = viewer.getByRole('img');
      await expect(picture).toBeVisible();
      await expect
        .poll(() =>
          picture.evaluate((img: HTMLImageElement) => img.naturalWidth)
        )
        .toBe(1);
      saw('STC-979');
      // What the viewer shows is the file the email service holds: the
      // bytes behind the picture are those the service answers for the
      // thread's attachment.
      const address = await picture.getAttribute('src');
      expect(address).toBeTruthy();
      await expect
        .poll(async () =>
          (await storedAttachment(mailbox, thread.id, 'photo.png'))?.toString(
            'base64'
          )
        )
        .toBe(PHOTO.toString('base64'));
      expect(await pictureBytes(page, address ?? '')).toBe(
        PHOTO.toString('base64')
      );
      confirmed('F-185');
      await page.keyboard.press('Escape');
      await expect(viewer).toBeHidden();

      await removeMenu.click();
      did('AC-087');
      await expect(removeMenu).toHaveCount(0);
      await expect(removePhoto).toBeVisible();
      saw('STC-978');

      await page.getByRole('button', { name: 'Send email' }).click();
      await expect
        .poll(
          async () =>
            (await readMailbox(mailbox, ZED)).map(
              (message) => message.attachments
            ),
          { timeout: 30_000 }
        )
        .toEqual([['photo.png']]);
      confirmed('F-123');
    });

    test('a file too large to attach is offered as a link', async ({
      page,
      mailbox,
    }) => {
      await addMailbox(mailbox, ZED);
      await composeNew(page, mailbox, {
        to: ZED,
        subject: 'Survey',
        body: 'The survey is too big to attach.',
      });
      await routeDraftId(page);
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
      await expect(
        offer.getByText(
          '"survey.txt" won\'t fit as an attachment. Upload it to Macro and share a view-only link instead?'
        )
      ).toBeVisible();
      await expect(
        offer.getByRole('button', { name: 'Share link' })
      ).toBeVisible();
      saw('STC-021');
      // Sharing the link uploads a document, which this stack cannot store.
      await offer.getByRole('button', { name: 'Cancel' }).click();
      await expect(offer).toBeHidden();
      await expect(
        page.getByRole('button', { name: 'Remove survey.txt' })
      ).toHaveCount(0);
    });
  });
}

test.describe('cloud attachments of an Outlook message', () => {
  test.use({ provider: 'OUTLOOK' });

  test('a cloud attachment opens at the provider from the message and from a forward', async ({
    page,
    mailbox,
    context,
  }) => {
    await context.route('https://files.example/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<p>The deck</p>' })
    );
    await mailbox.deliver({
      from: 'Grace <grace@example.com>',
      subject: 'Quarter deck',
      text: 'The deck is linked.',
      attachments: [
        {
          filename: 'deck.pptx',
          mimeType: 'application/octet-stream',
          base64: Buffer.from('a link to the deck').toString('base64'),
        },
      ],
    });
    const thread = await mailbox.synced('Quarter deck');
    // The Outlook emulator serves no cloud attachments, so the address the
    // sync would have stored for one is written to the stored attachment.
    const linked = await mailbox.stack.sql(
      `UPDATE email_attachments SET reference_url = '${CLOUD_FILE}'
       WHERE filename = 'deck.pptx' RETURNING id`
    );
    expect(linked).toHaveLength(1);

    await mailbox.open(`/app/mail/${thread.id}`);
    await expect(page.getByText('The deck is linked.')).toBeVisible();
    const opened = context.waitForEvent('page');
    await page.getByRole('button', { name: 'deck.pptx', exact: true }).click();
    did('AL-507');
    const tab = await opened;
    await expect(tab).toHaveURL(CLOUD_FILE);
    await tab.close();

    await page.getByText('The deck is linked.').first().hover();
    await page.getByRole('button', { name: 'Forward', exact: true }).click();
    const advice = page.getByRole('status').filter({
      hasText:
        'Linked cloud attachments are available in the original Outlook message. Share their links from Outlook to include them in this forward.',
    });
    await expect(advice).toBeVisible();
    saw('STC-023');
    const original = context.waitForEvent('page');
    await advice.getByRole('link', { name: 'Open in Outlook' }).click();
    did('AC-101');
    const outlook = await original;
    await expect(outlook).toHaveURL(CLOUD_FILE);
  });
});
