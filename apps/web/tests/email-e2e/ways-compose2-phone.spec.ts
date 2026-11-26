import type { Locator, Page } from '@playwright/test';
import { loadAppSteadily, relayUploads } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { threadMessages } from './harness/send';
import {
  hasDraft,
  openThread,
  PHONE,
  sentCopy,
  YARA,
} from './harness/ways-compose2';
import { did } from './ledger/record';

/** Opens a thread on the phone and its full-screen reply composer. */
async function phoneReply(page: Page, mailbox: Mailbox, subject: string) {
  const thread = await openThread(page, mailbox, subject);
  expect(await page.evaluate(() => window.innerWidth)).toBe(
    PHONE.viewport.width
  );
  await page
    .locator('[data-mobile-dock-island]')
    .getByRole('button', { name: 'Reply', exact: true })
    .tap();
  const composer = page.getByRole('dialog', { name: 'Reply composer' });
  const editor = composer.getByRole('textbox', { name: /reference files/ });
  await expect(editor).toBeVisible();
  return { thread, composer, editor };
}

async function write(editor: Locator, text: string) {
  await editor.tap();
  await editor.pressSequentially(text);
  await expect(editor).toContainText(text);
}

/** Saves the reply from the Draft options sheet; the service then holds it. */
async function saveFromSheet(
  page: Page,
  mailbox: Mailbox,
  threadId: string,
  composer: Locator,
  text: string
) {
  const sheet = page.getByRole('dialog', { name: 'Draft options' });
  await expect(
    sheet.getByRole('button', { name: 'Delete Draft' })
  ).toBeVisible();
  await sheet.getByRole('button', { name: 'Save Draft' }).tap();
  await expect(composer).toHaveCount(0);
  // A draft keeps its body as HTML only (its body_text is empty).
  await expect
    .poll(
      async () =>
        (await threadMessages(mailbox, threadId))
          .filter((message) => message.is_draft)
          .map((message) => message.body_html_sanitized ?? ''),
      { message: 'the service holds no draft with the reply' }
    )
    .toEqual([expect.stringContaining(text)]);
}

for (const provider of ['GMAIL', 'OUTLOOK'] as const) {
  test.describe(`the phone's reply composer in ${provider === 'GMAIL' ? 'a Gmail' : 'an Outlook'} inbox`, () => {
    test.use({ ...PHONE, provider });
    test.beforeEach(async ({ page }) => {
      await loadAppSteadily(page);
      await relayUploads(page);
    });

    // When this fails, the caret beside To: on a phone no longer shows (or
    // hides) the Cc: and Bcc: rows, or an address typed in the row it showed
    // is not copied on the reply the provider sends.
    test('the caret shows and hides Cc and Bcc, and an address in the shown Cc is copied', async ({
      page,
      mailbox,
    }) => {
      const subject = 'Phone copy';
      const { composer, editor } = await phoneReply(page, mailbox, subject);
      // The caret has a tooltip but no name: it is the To: row's own button.
      const caret = composer
        .getByText('To:', { exact: true })
        .locator('xpath=..')
        .locator('> button');
      const cc = composer.getByText('Cc:', { exact: true });
      const bcc = composer.getByText('Bcc:', { exact: true });
      await expect(caret).toHaveAttribute('aria-expanded', 'false');
      await expect(cc).toBeHidden();

      await caret.tap();
      did('AC-076');
      await expect(caret).toHaveAttribute('aria-expanded', 'true');
      await expect(cc).toBeVisible();
      await expect(bcc).toBeVisible();
      await caret.tap();
      did('AC-076');
      await expect(cc).toBeHidden();
      await expect(bcc).toBeHidden();

      await caret.tap();
      const field = cc.locator('xpath=..').getByRole('combobox');
      await field.tap();
      await field.fill(YARA);
      await page.keyboard.press('Enter');
      await write(editor, 'Copying Yara.');
      await composer.getByRole('button', { name: 'Send email' }).tap();
      await expect(composer).toHaveCount(0);

      const sent = await sentCopy(mailbox, `Re: ${subject}`);
      expect(sent.cc).toEqual([YARA]);
    });

    // When this fails, leaving the phone's reply composer loses what was
    // written (no Draft options sheet, or Save Draft stores nothing), or an
    // empty reply left behind is kept as a draft nobody wrote.
    test('leaving a written reply offers to save it as a draft, and leaving an empty one stores nothing', async ({
      page,
      mailbox,
    }) => {
      await test.step('Go Back with a reply written', async () => {
        const { thread, composer, editor } = await phoneReply(
          page,
          mailbox,
          'Leave by Go Back'
        );
        await write(editor, 'Kept by Go Back.');
        await composer.getByRole('button', { name: 'Go Back' }).tap();
        did('AC-096');
        await saveFromSheet(
          page,
          mailbox,
          thread.id,
          composer,
          'Kept by Go Back.'
        );
      });

      await test.step('Go Back with nothing written', async () => {
        const { thread, composer } = await phoneReply(
          page,
          mailbox,
          'Leave empty'
        );
        await composer.getByRole('button', { name: 'Go Back' }).tap();
        did('AC-096');
        await expect(composer).toHaveCount(0);
        await expect(
          page.getByRole('dialog', { name: 'Draft options' })
        ).toHaveCount(0);
        expect(await hasDraft(mailbox, thread.id)).toBe(false);
      });
    });

    // When this fails, Escape while writing a phone reply does not leave it
    // (nor does Android's system Back, which the app turns into Escape on
    // the focused editor). Today the editor's wrapper stops every keydown,
    // so the full-screen dialog never hears it (handoff
    // phone-reply-escape-swallowed-by-editor).
    test('known bug: phone-reply-escape-swallowed-by-editor: Escape while writing a reply offers to save it as a draft @known-bug', {
      tag: '@known-bug',
    }, async ({ page, mailbox }) => {
      const { thread, composer, editor } = await phoneReply(
        page,
        mailbox,
        'Leave by Escape'
      );
      await write(editor, 'Kept by Escape.');
      await expect(editor).toBeFocused();
      await page.keyboard.press('Escape');
      did('AC-096');
      await saveFromSheet(
        page,
        mailbox,
        thread.id,
        composer,
        'Kept by Escape.'
      );
    });

    // When this fails, the Attach button in the header of the phone's reply
    // composer opens no file picker, or the chosen file does not go out
    // with the reply the provider sends.
    test("the header's Attach sends the chosen file with the reply", async ({
      page,
      mailbox,
    }) => {
      const subject = 'Phone file';
      const { composer, editor } = await phoneReply(page, mailbox, subject);
      await write(editor, 'Attached.');
      const chooser = page.waitForEvent('filechooser');
      await composer.getByRole('button', { name: 'Attach' }).tap();
      await (await chooser).setFiles({
        name: 'menu.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('soup of the day'),
      });
      did('AC-084');
      await expect(
        composer.getByRole('button', { name: 'Remove menu.txt' })
      ).toBeVisible();
      await composer.getByRole('button', { name: 'Send email' }).tap();
      await expect(composer).toHaveCount(0);

      const sent = await sentCopy(mailbox, `Re: ${subject}`);
      expect(sent.attachments).toEqual(['menu.txt']);
    });
  });
}
