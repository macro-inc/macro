import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { replyEditor } from './harness/send';
import { replyScrollBox, replyToLong } from './harness/ways-compose-more';
import {
  hasDraft,
  inside,
  replyTo,
  send,
  sentCopy,
  XAVIER,
  YARA,
} from './harness/ways-compose2';
import { did } from './ledger/record';

test.beforeEach(({ page }) => loadAppSteadily(page));

const SIGNATURE = 'Ada of the Harbour Office';

for (const provider of ['GMAIL', 'OUTLOOK'] as const) {
  test.describe(`the text of a reply in ${provider === 'GMAIL' ? 'a Gmail' : 'an Outlook'} inbox`, () => {
    test.use({ provider });

    // When this fails, Bold in the menu that floats over selected text no
    // longer makes it bold: the reply the provider sends has the word plain.
    // Nothing is typed after Bold: the menu hands focus back to the editor
    // later than its click returns, with the word selected again, so a key
    // pressed then can land on that selection and replace the word.
    test('text made bold from the floating menu is sent bold', async ({
      page,
      mailbox,
    }) => {
      const subject = 'Heavy words';
      await replyTo(page, mailbox, subject);
      const editor = replyEditor(page);
      await editor.click();
      await page.keyboard.type('heavy');
      await page.keyboard.press('Shift+Home');
      await page
        .getByRole('toolbar')
        .getByRole('button', { name: 'Bold', exact: true })
        .click();
      did('AC-041');
      await expect(editor.locator('strong')).toHaveText('heavy');
      await send(page);

      const { html } = await sentCopy(mailbox, `Re: ${subject}`);
      expect(inside(html, 'strong', 'heavy'), html).toBe(true);
    });

    // When this fails, what is typed as `:name`, `[]` or ``` in a reply
    // stays those characters: the reply the provider sends lacks the
    // emoji, the checklist or the code block the writer saw.
    test('an emoji, a checkbox and a code block typed in a reply are sent as such', async ({
      page,
      mailbox,
    }) => {
      const subject = 'Formats';
      await replyTo(page, mailbox, subject);
      const editor = replyEditor(page);
      await editor.click();

      // The menu lists every name the letters start, smiley first; the
      // one named is taken from it.
      await page.keyboard.type(':smil');
      did('AC-043');
      await page.getByText('smile', { exact: true }).click();
      await expect(editor).toContainText('😄');
      await expect(editor).not.toContainText(':smil');
      await page.keyboard.press('Enter');
      await page.keyboard.type('[] book the room');
      did('AC-043');
      await expect(
        editor.getByRole('checkbox', { name: 'book the room' })
      ).toBeVisible();
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await page.keyboard.type('``` ');
      did('AC-043');
      await page.keyboard.type('let x = 1;');
      await expect(editor.locator('code')).toHaveText('let x = 1;');
      await send(page);

      const { html } = await sentCopy(mailbox, `Re: ${subject}`);
      expect(html).toContain('😄');
      expect(html).toMatch(
        /<ul\b[^>]*\bmd-check\b[^>]*>\s*<li\b[^>]*>(?:\s*<(?!\/)[^>]*>)*book the room/
      );
      expect(html).toMatch(
        /<(pre|code)\b[^>]*>(?:\s*<(?!\/)[^>]*>)*let x = 1;/
      );
    });

    // When this fails, "Don't include signature" on a reply does nothing:
    // the reply the provider sends still ends in the signature the writer
    // took out.
    test('a reply whose signature was dismissed is sent without it', async ({
      page,
      mailbox,
    }) => {
      const saved = await mailbox.api('/email/email/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          settings: {
            signature: `<p>${SIGNATURE}</p>`,
            signature_on_replies_forwards: true,
          },
        }),
      });
      expect(saved.ok).toBe(true);
      const subject = 'Unsigned';
      await replyTo(page, mailbox, subject);
      // The reply would carry the signature: its preview bar is there.
      const dismiss = page.getByRole('button', {
        name: "Don't include signature",
      });
      await expect(dismiss).toBeVisible();
      await replyEditor(page).click();
      await page.keyboard.type('No sign-off today.');

      await dismiss.click();
      did('AC-103');
      await expect(dismiss).toBeHidden();
      await send(page);

      const { html } = await sentCopy(mailbox, `Re: ${subject}`);
      expect(html).toContain('No sign-off today.');
      expect(html).not.toContain(SIGNATURE);
    });

    // When this fails, one of the three shortcuts that discard a reply no
    // longer does: the composer stays, or closes while the email service
    // keeps the draft, which then comes back when the thread is opened.
    test('each discard shortcut closes the reply and removes its stored draft', async ({
      page,
      mailbox,
    }) => {
      const shortcuts = ['Period', 'Comma', 'KeyD'];
      for (const key of shortcuts) {
        await test.step(key, async () => {
          const thread = await replyTo(page, mailbox, `Discard by ${key}`);
          await replyEditor(page).click();
          await page.keyboard.type('Never mind.');
          await expect
            .poll(() => hasDraft(mailbox, thread.id), {
              message: 'the reply was never stored as a draft',
            })
            .toBe(true);

          await page.keyboard.press(`Shift+ControlOrMeta+${key}`);
          did('AC-312');
          await expect(replyEditor(page)).toBeHidden();
          await expect
            .poll(() => hasDraft(mailbox, thread.id), {
              message: `the draft outlived the ${key} shortcut`,
            })
            .toBe(false);
        });
      }
    });
  });
}

// Gmail only: the box grows on the screen, whatever the mailbox.
// When this fails, scrolling a long reply no longer makes its box taller:
// the writer keeps reading their own text through a slot a few lines high.
test('scrolling inside a long reply makes its box taller', async ({
  page,
  mailbox,
}) => {
  await replyToLong(page, mailbox, 'Long reply', 40);
  const editor = replyEditor(page);
  await editor.click();
  await page.keyboard.type('Short answer.');
  // The quote goes in below the caret, which stays on the first line: the
  // box overflows without having scrolled, at its collapsed height.
  await page.getByRole('button', { name: 'quoted text' }).click();
  await expect(editor).toContainText('Point 40.');
  const box = replyScrollBox(editor);
  await expect.poll(box.overflows).toBe(true);
  expect(await box.scrollTop()).toBe(0);
  const before = await box.height();

  await editor.hover();
  await page.mouse.wheel(0, 200);
  did('AC-100');
  await expect.poll(box.height).toBeGreaterThan(before);
});

// Gmail only: the event composer is filled from the reply on the screen.
// When this fails, "Create event" in a reply's footer opens no event
// composer, or one that lost the thread's subject or its people as guests.
test("a reply's Create event opens an event with the subject and the people of the reply", async ({
  page,
  mailbox,
}) => {
  // The model that would refine the event is not part of the stack; the
  // full-stack tier refuses it the same way.
  await page.route('**/universal_input/**', (route) =>
    route.fulfill({ status: 503 })
  );
  await replyTo(page, mailbox, 'Harbour walk', { all: true });
  await replyEditor(page).click();
  await page.keyboard.type('Saturday at ten?');

  await page.getByRole('button', { name: 'Create event' }).click();
  did('AC-097');
  const composer = page.getByRole('dialog');
  await expect(composer.getByRole('textbox', { name: 'Title' })).toHaveValue(
    /Harbour walk/
  );
  // The guests fold into a count; their list opens from it.
  const guests = composer.getByRole('button', { name: 'Guests' });
  await expect(guests).toHaveText('2 guests');
  await guests.click();
  await expect(page.getByText(XAVIER, { exact: true })).toBeVisible();
  await expect(page.getByText(YARA, { exact: true })).toBeVisible();
});
