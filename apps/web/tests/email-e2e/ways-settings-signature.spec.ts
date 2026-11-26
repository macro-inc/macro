// Writing an inbox's signature in the Rich text view of Settings › Email: the
// toolbar, pasting a link over words, resizing an image, and what happens
// when a signature with a layout of its own meets the rich-text editor. Each
// way in ends in what the email service then holds as the inbox's signature.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { PROVIDERS } from './harness/providers';
import {
  openRichText,
  pasteFromClipboard,
  pick,
  richText,
  saveSignature,
  signatureTabs,
  storedSignature,
} from './harness/ways-settings';
import { filedPicture, openSettled } from './harness/ways-settings-more';
import { did } from './ledger/record';

const table = (name: string) =>
  `<table><tbody><tr><td>${name}</td><td>Analytical Engines</td></tr></tbody></table>`;

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await loadAppSteadily(page);
});

for (const provider of PROVIDERS) {
  const inbox = provider === 'GMAIL' ? 'a Gmail' : 'an Outlook';

  test.describe(`the rich-text signature of ${inbox} inbox`, () => {
    test.use({ provider });

    // When this fails, what is typed in Rich text, a toolbar button, a link
    // pasted over words or a resized picture does not reach the signature
    // that is saved: mail goes out with a signature other than the one shown.
    test('typing, the buttons, a pasted link and a resized picture are saved as shown', async ({
      page,
      mailbox,
    }) => {
      const own = mailbox.inbox.email;
      await openSettled(page, mailbox);
      await openRichText(page, own);
      const editor = richText(page, own);

      const save = page.getByRole('button', { name: 'Save signature' });
      await expect(save).toBeDisabled();
      await editor.click();
      await page.keyboard.type('Ada Lovelace');
      did('AX-017');
      await expect(editor).toHaveText('Ada Lovelace');
      // The words reached the signature to be saved, not only the page.
      await expect(save).toBeEnabled();

      // Each button changes the selected words, and Clear formatting undoes it.
      await page.keyboard.press('Shift+Home');
      for (const [button, tag] of [
        ['Bold', 'strong'],
        ['Italic', 'em'],
        ['Underline', 'u'],
      ] as const) {
        await page.getByRole('button', { name: button, exact: true }).click();
        did('AX-018');
        await expect(editor.locator(tag)).toHaveText('Ada Lovelace');
      }
      await page.getByRole('button', { name: 'Clear formatting' }).click();
      did('AX-018');
      await expect(editor.locator('strong, em, u')).toHaveCount(0);
      await page.getByRole('button', { name: 'Bold', exact: true }).click();
      did('AX-018');

      await pasteFromClipboard(page, { text: 'https://ada.example/about' });
      did('AX-202');
      await expect(
        editor.getByRole('link', { name: 'Ada Lovelace' })
      ).toHaveAttribute('href', 'https://ada.example/about');

      await saveSignature(page);
      const stored = await storedSignature(mailbox);
      // Bold around the link that the pasted address made of the words.
      expect(stored).toMatch(
        /<strong><a [^>]*href="https:\/\/ada\.example\/about"[^>]*>Ada(&nbsp;| )Lovelace<\/a><\/strong>/
      );
      expect(stored).not.toMatch(/<(em|u)>/);
    });

    // When this fails, dragging the corner of a picture in the signature
    // does not change the width the picture is saved with.
    test('a picture dragged wider is saved at the width it was dragged to', async ({
      page,
      mailbox,
    }) => {
      const own = mailbox.inbox.email;
      const logo = await filedPicture(page);
      await openSettled(page, mailbox);
      // The picture comes in through the HTML view; Rich text resizes it.
      await signatureTabs(page, own).getByRole('tab', { name: 'HTML' }).click();
      await page
        .getByRole('textbox', { name: `Signature HTML for ${own}` })
        .fill(`<p><img src="${logo}" width="80" height="40"></p>`);
      await openRichText(page, own);
      const picture = richText(page, own).getByRole('img');
      await picture.click();
      const grip = await page.locator('.ql-image-resizer-handle').boundingBox();
      if (!grip) throw new Error('the picture shows no resize handle');
      const from = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + 40, from.y + 10, { steps: 4 });
      await page.mouse.up();
      did('AX-201');
      await expect(picture).toHaveAttribute('width', '120');

      await saveSignature(page);
      const stored = await storedSignature(mailbox);
      expect(stored).toContain(`src="${logo}"`);
      expect(stored).toContain('width="120"');
    });

    // When this fails, a choice in one of the toolbar's lists, a list button
    // or the Link button changes the editor without changing the signature
    // that is saved.
    test('the font, size, colors, lists and Link button are saved as chosen', async ({
      page,
      mailbox,
    }) => {
      const own = mailbox.inbox.email;
      await openSettled(page, mailbox);
      await openRichText(page, own);
      const editor = richText(page, own);
      await editor.click();
      await page.keyboard.type('Ada Lovelace');
      await page.keyboard.press('Shift+Home');

      for (const [name, value] of [
        ['Font', 'Georgia'],
        ['Font size', '20px'],
        ['Text color', '#e60000'],
        ['Highlight color', '#ffff00'],
      ] as const) {
        await pick(page, name, value);
        did('AX-018');
      }
      await page.getByRole('button', { name: 'Link', exact: true }).click();
      did('AX-018');
      await page.locator('.ql-tooltip input').fill('https://ada.example/about');
      await page.keyboard.press('Enter');
      await expect(
        editor.getByRole('link', { name: 'Ada Lovelace' })
      ).toBeVisible();

      await page.getByRole('button', { name: 'Numbered list' }).click();
      did('AX-018');
      await expect(editor.locator('li[data-list="ordered"]')).toHaveCount(1);
      await page.getByRole('button', { name: 'Bulleted list' }).click();
      did('AX-018');
      await expect(editor.locator('li[data-list="bullet"]')).toHaveCount(1);

      await saveSignature(page);
      const stored = await storedSignature(mailbox);
      expect(stored).toMatch(/Ada(&nbsp;| )Lovelace/);
      for (const kept of [
        '<ul',
        'href="https://ada.example/about"',
        'font-family:Georgia',
        'font-size:20px',
        'color:rgb(230, 0, 0)',
        'background-color:rgb(255, 255, 0)',
      ]) {
        expect(stored).toContain(kept);
      }
    });

    // When this fails, a signature with a layout of its own (a table) is
    // flattened by the rich-text editor without the person agreeing to it, or
    // the answer to the question is not the one that is saved.
    test('a signature with its own layout is kept or converted only as answered', async ({
      page,
      mailbox,
    }) => {
      const own = mailbox.inbox.email;
      const tabs = signatureTabs(page, own);
      const selected = (name: string) =>
        expect(tabs.getByRole('tab', { name })).toHaveAttribute(
          'aria-selected',
          'true'
        );
      const dialog = (title: string) =>
        page.getByRole('alertdialog').or(page.getByRole('dialog')).filter({
          hasText: title,
        });
      const preview = page.getByLabel(`Signature preview for ${own}`);
      await openSettled(page, mailbox);
      await openRichText(page, own);

      // Into an empty editor the pasted layout goes as it is, without asking.
      await richText(page, own).click();
      await pasteFromClipboard(page, { text: 'Ada', html: table('Ada') });
      did('AX-204');
      await selected('Preview');
      await expect(preview.getByRole('table')).toContainText('Ada');
      await saveSignature(page);
      expect(await storedSignature(mailbox)).toContain('<table');

      // Opening Rich text on it asks first; Cancel stays, Continue converts.
      const convert = dialog('Convert to rich text?');
      await tabs.getByRole('tab', { name: 'Rich text' }).click();
      await convert.getByRole('button', { name: 'Cancel' }).click();
      did('AX-203');
      await expect(convert).toBeHidden();
      await selected('Preview');
      await expect(preview.getByRole('table')).toContainText('Ada');

      await tabs.getByRole('tab', { name: 'Rich text' }).click();
      await convert
        .getByRole('button', { name: 'Continue to rich text' })
        .click();
      did('AX-022');
      await selected('Rich text');
      const editor = richText(page, own);
      await expect(editor).toContainText('Ada');
      await editor.click();
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.type(' converted');
      await saveSignature(page);
      expect(await storedSignature(mailbox)).toContain('converted');

      // Pasting a layout over a signature asks before replacing it. Saving
      // showed the signature in Preview again, and the rich-text editor kept
      // its table, so Rich text asks once more.
      const replace = dialog('Replace with pasted signature?');
      await tabs.getByRole('tab', { name: 'Rich text' }).click();
      await convert
        .getByRole('button', { name: 'Continue to rich text' })
        .click();
      await selected('Rich text');
      await editor.click();
      await pasteFromClipboard(page, { text: 'Grace', html: table('Grace') });
      await replace.getByRole('button', { name: 'Cancel' }).click();
      did('AX-205');
      await expect(replace).toBeHidden();
      await selected('Rich text');
      await expect(editor).toContainText('converted');
      await expect(editor).not.toContainText('Grace');

      await editor.click();
      await pasteFromClipboard(page, { text: 'Grace', html: table('Grace') });
      await replace
        .getByRole('button', { name: 'Use pasted signature' })
        .click();
      did('AX-023');
      await selected('Preview');
      await expect(preview.getByRole('table')).toContainText('Grace');
      await saveSignature(page);
      const stored = await storedSignature(mailbox);
      expect(stored).toContain('<table');
      expect(stored).toContain('Grace');
      expect(stored).not.toContain('converted');
    });
  });
}
