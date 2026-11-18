// The Subject: field of the phone's reply composer: editing it changes the
// subject the provider sends, and Escape is meant to leave it. A desktop
// reply never shows the field: its thread always replies to a message, so
// the envelope's reopened-draft Subject is not reached there.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { anInbox, PROVIDERS } from './harness/providers';
import { phoneReply } from './harness/states-compose';
import { PHONE, sentCopy } from './harness/ways-compose2';
import { did, saw } from './ledger/record';

test.beforeEach(({ page }) => loadAppSteadily(page));

for (const provider of PROVIDERS) {
  test.describe(`the phone's reply subject in ${anInbox(provider)}`, () => {
    test.use({ ...PHONE, provider });

    // When this fails, a reply with no text can be sent from the phone's
    // header, its Subject: field no longer hints what it is for once
    // emptied, or a subject typed there is not the subject the provider
    // sends the reply with.
    test('a reply is sent with the subject typed in its Subject: field', async ({
      page,
      mailbox,
    }) => {
      const subject = 'Phone subject';
      const changed = 'Phone subject, renamed';
      const { composer, editor } = await phoneReply(page, mailbox, subject);
      const send = composer.getByRole('button', { name: 'Send email' });
      await expect(send).toBeDisabled();
      saw('STC-312');
      const field = composer.getByPlaceholder('Subject:', { exact: true });
      await expect(field).toHaveValue(`Re: ${subject}`);
      await field.fill('');
      await expect(field).toHaveValue('');
      await expect(field).toHaveAttribute('placeholder', 'Subject:');
      saw('STC-009');

      await field.fill(changed);
      did('AC-080');
      await editor.tap();
      await editor.pressSequentially('Renamed on the phone.');
      await expect(editor).toContainText('Renamed on the phone.');
      await expect(send).toBeEnabled();
      await send.tap();
      await expect(composer).toHaveCount(0);

      const sent = await sentCopy(mailbox, changed);
      expect(sent.subject).toBe(changed);
    });
  });
}

test.describe("the phone's reply subject", () => {
  test.use({ ...PHONE });

  // When this fails, Escape in the phone's reply Subject: field does not
  // leave it: the field blurs itself, and the full-screen composer's focus
  // trap puts the focus straight back, so the keyboard stays up on the
  // field. The field is the same code whatever the provider: Gmail only.
  test('known bug: phone-reply-subject-escape-keeps-focus: Escape leaves the Subject: field @known-bug', {
    tag: '@known-bug',
  }, async ({ page, mailbox }) => {
    const { composer } = await phoneReply(page, mailbox, 'Leave the subject');
    const field = composer.getByPlaceholder('Subject:', { exact: true });
    await field.tap();
    await expect(field).toBeFocused();
    await field.press('Escape');
    did('AC-319');
    await expect(field).not.toBeFocused();
    await expect(composer).toBeVisible();
  });
});
