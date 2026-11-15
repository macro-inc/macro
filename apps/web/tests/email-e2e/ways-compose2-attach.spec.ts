import type { Page } from '@playwright/test';
import {
  attach,
  attachButton,
  body,
  composeNew,
  draftThreads,
  dropFile,
  loadAppSteadily,
  relayUploads,
  routeDraftId,
} from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { htmlBody, onlySentRaw, replyEditor } from './harness/send';
import {
  PIXEL,
  pasteFile,
  replyTo,
  send,
  sentCopy,
  stubStaticFiles,
} from './harness/ways-compose2';
import type { ActionId } from './ledger/manifest';
import { did } from './ledger/record';

test.beforeEach(async ({ page }) => {
  await loadAppSteadily(page);
  await relayUploads(page);
});

const CLOUD_FILE = 'https://files.example/deck';

/** A file named after the way that attaches it. A video: the editor keeps
 * pictures in the text, and turns only videos it is handed into attachments. */
const clip = (row: string) => ({
  name: `${row}.mp4`,
  mimeType: 'video/mp4',
  base64: Buffer.from(`a clip by ${row}`).toString('base64'),
});

async function choose(page: Page, row: string, open: () => Promise<void>) {
  const chooser = page.waitForEvent('filechooser');
  await open();
  const { name, mimeType, base64 } = clip(row);
  await (await chooser).setFiles({
    name,
    mimeType,
    buffer: Buffer.from(base64, 'base64'),
  });
}

/** Every way to attach a file to a reply. */
const ATTACHES: { row: ActionId; attach: (page: Page) => Promise<void> }[] = [
  {
    row: 'AC-084',
    attach: (page) => choose(page, 'AC-084', () => attachButton(page).click()),
  },
  {
    row: 'AC-310',
    attach: (page) =>
      choose(page, 'AC-310', () =>
        page.keyboard.press('Shift+ControlOrMeta+KeyU')
      ),
  },
  {
    row: 'AC-085',
    attach: (page) => dropFile(replyEditor(page), clip('AC-085')),
  },
  {
    row: 'AC-086',
    attach: (page) => pasteFile(replyEditor(page), clip('AC-086')),
  },
];

for (const provider of ['GMAIL', 'OUTLOOK'] as const) {
  test.describe(`files added to a reply in ${provider === 'GMAIL' ? 'a Gmail' : 'an Outlook'} inbox`, () => {
    test.use({ provider });

    // When this fails, one of the ways to attach a file to a reply (the
    // footer's paperclip, its shortcut, a file dropped on the text or pasted
    // into it) no longer attaches: no chip, or the reply the provider sends
    // goes out without the file.
    test('every way to attach a file to a reply sends the file with it', async ({
      page,
      mailbox,
    }) => {
      for (const way of ATTACHES) {
        await test.step(way.row, async () => {
          const subject = `File by ${way.row}`;
          await replyTo(page, mailbox, subject);
          await replyEditor(page).click();
          await page.keyboard.type('Attached.');
          await way.attach(page);
          did(way.row, 'F-122');
          await expect(
            page.getByRole('button', { name: `Remove ${way.row}.mp4` })
          ).toBeVisible();
          await send(page);

          const sent = await sentCopy(mailbox, `Re: ${subject}`);
          expect(sent.attachments, way.row).toEqual([`${way.row}.mp4`]);
        });
      }
    });

    // When this fails, a picture dropped on a reply's text or pasted into it
    // is not put in the text (it becomes a chip, or nothing), or the reply
    // the provider sends shows no picture where the writer put it.
    test('a picture dropped on or pasted into a reply is sent inside its text', async ({
      page,
      mailbox,
    }) => {
      const uploads = stubStaticFiles(mailbox);
      const picture = { name: 'map.png', mimeType: 'image/png', base64: PIXEL };
      const ways = [
        {
          row: 'AC-085' as const,
          put: () => dropFile(replyEditor(page), picture),
        },
        {
          row: 'AC-086' as const,
          put: () => pasteFile(replyEditor(page), picture),
        },
      ];
      for (const [index, way] of ways.entries()) {
        await test.step(way.row, async () => {
          const subject = `Picture by ${way.row}`;
          await replyTo(page, mailbox, subject);
          await replyEditor(page).click();
          await page.keyboard.type('The map:');
          await way.put();
          did(way.row, 'F-105');
          await expect(replyEditor(page).locator('img')).toHaveCount(1);
          await expect.poll(() => uploads).toHaveLength(index + 1);
          await send(page);

          const { html } = await sentCopy(mailbox, `Re: ${subject}`);
          expect(html, way.row).toMatch(/<img[^>]+src="(cid:|https?:)/);
          expect(html, way.row).not.toContain('blob:');
        });
      }
    });
  });
}

// Gmail only: the notice is the browser's own state, whatever the mailbox.
// When this fails, the "You're offline" notice cannot be dismissed with its
// button, or the file chosen while offline is attached after all and the
// reply is sent with a file the writer was told was refused.
test('the offline notice is dismissed with its button and the refused file is not attached', async ({
  page,
  mailbox,
}) => {
  const subject = 'Offline file';
  await replyTo(page, mailbox, subject);
  await replyEditor(page).click();
  await page.keyboard.type('Nothing attached.');
  await page.context().setOffline(true);
  await choose(page, 'AC-072', () => attachButton(page).click());
  const heading = page.getByRole('heading', { name: "You're offline" });
  await expect(heading).toBeVisible();
  await expect(
    page.getByText(
      "Attachments can't be added while you're offline. Reconnect and try again."
    )
  ).toBeVisible();

  await page.getByRole('button', { name: 'OK', exact: true }).click();
  did('AC-072');
  await expect(heading).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'Remove AC-072.mp4' })
  ).toHaveCount(0);
  await page.context().setOffline(false);
  await send(page);
  expect((await sentCopy(mailbox, `Re: ${subject}`)).attachments).toEqual([]);
});

// Gmail only: the picture is still the browser's own file, whatever the
// mailbox.
// When this fails, clicking the chip of a picture attached to a new message
// opens no viewer, or a viewer without the picture: the writer cannot check
// what they are about to send.
test("a new message's picture chip opens the picture in the viewer", async ({
  page,
  mailbox,
}) => {
  await composeNew(page, mailbox, {
    to: 'bob@example.com',
    subject: 'Harbour',
    body: 'The photo.',
  });
  await routeDraftId(page);
  await attach(page, {
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PIXEL, 'base64'),
  });
  const remove = page.getByRole('button', { name: 'Remove photo.png' });
  await expect(remove).toBeVisible();

  await remove
    .locator('xpath=..')
    .getByRole('button', { name: 'photo.png', exact: true })
    .click();
  did('AC-030');
  const picture = page.getByRole('dialog').getByRole('img');
  await expect(picture).toBeVisible();
  await expect
    .poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(1);
  await page.keyboard.press('Escape');
  await expect(picture).toBeHidden();
  // The message still goes out with the picture the viewer showed.
  await page.getByRole('button', { name: 'Send email' }).click();
  expect(await onlySentRaw(mailbox)).toContain('photo.png');
  expect(htmlBody(await onlySentRaw(mailbox))).toContain('The photo.');
});

test.describe('a cloud attachment of an Outlook draft', () => {
  test.use({ provider: 'OUTLOOK' });

  // When this fails, the chip of a file the draft only links to at the
  // provider opens nothing (or tries to download a file Macro does not
  // hold) instead of the provider's page for it.
  test("a draft's cloud attachment chip opens the file at the provider", async ({
    page,
    mailbox,
    context,
  }) => {
    await context.route('https://files.example/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<p>The deck</p>' })
    );
    const created = await fetch(
      `${mailbox.stack.info.outlookUrl}/_emulator/mailboxes/${encodeURIComponent(mailbox.inbox.email)}/messages`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          to: 'linus@example.com',
          subject: 'Deck draft',
          html: '<div>The deck is linked.</div>',
          folder: 'drafts',
          attachments: [{ filename: 'deck.pptx', text: 'a link to the deck' }],
        }),
      }
    );
    expect(created.ok).toBe(true);
    await expect
      .poll(
        async () => (await draftThreads(mailbox)).map((thread) => thread.name),
        { timeout: 60_000 }
      )
      .toEqual(['Deck draft']);
    const [draft] = await draftThreads(mailbox);
    // The Outlook emulator serves no cloud attachments, so the address the
    // sync would have stored for one is written to the stored attachment
    // (as `attachment-draft.spec.ts` does for a received message).
    await expect
      .poll(
        async () =>
          (
            await mailbox.stack.sql(
              `UPDATE email_attachments SET reference_url = '${CLOUD_FILE}'
             WHERE filename = 'deck.pptx' RETURNING id`
            )
          ).length
      )
      .toBe(1);

    await mailbox.open(`/app/mail/${draft.id}`);
    await expect(body(page)).toContainText('The deck is linked.');
    const opened = context.waitForEvent('page');
    await page.getByRole('button', { name: 'deck.pptx', exact: true }).click();
    did('AC-320');
    await expect(await opened).toHaveURL(CLOUD_FILE);
  });
});
