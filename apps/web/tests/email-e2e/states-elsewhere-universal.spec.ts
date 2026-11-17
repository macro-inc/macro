// What the universal input's Email type says while an email is not ready:
// the line that names what is still missing, with Send email and Save as
// draft held back until it is given, and the offer to connect Google when
// no inbox is left to send from.
//
// The lines are the universal input's own checks, the same code whatever
// mailbox the inbox is, so this runs with a Gmail inbox only.

import { expect, test } from './harness/linking';
import {
  addRecipient,
  chooseEmail,
  pasteIntoRequest,
} from './harness/states-elsewhere';
import {
  disconnectInbox,
  openUniversalInput,
  universalInput,
} from './harness/ways-elsewhere';
import { saw } from './ledger/record';

const from = 'Grace <grace@example.com>';

test.describe('the Email type of the universal input, with a Gmail inbox', () => {
  // When this fails, an email that cannot be sent yet does not say why: the
  // line under the fields no longer asks for the subject, does not say that
  // attached context only goes to AI, or does not ask for an account once
  // none is connected; or Send email and Save as draft can be pressed while
  // it is shown, or stay held back once what it asked for is given.
  test('the Email type says what an email still needs, and holds Send email and Save as draft back until then', async ({
    page,
    mailbox,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await mailbox.deliver({
      from,
      subject: 'Quarterly numbers',
      text: 'Here.',
    });
    const thread = await mailbox.synced('Quarterly numbers');
    const input = universalInput(page);
    const send = input.getByRole('button', { name: 'Send email' });
    const save = input.getByRole('button', { name: 'Save as draft' });
    const subject = input.getByRole('textbox', { name: 'Subject' });

    await mailbox.open('/app/mail');
    await openUniversalInput(page);
    await chooseEmail(page);
    await addRecipient(page, 'bob@example.com');
    await expect(
      input.getByRole('link', { name: 'bob@example.com' })
    ).toBeVisible();
    await expect(
      input.getByText('Add a subject', { exact: true })
    ).toBeVisible();
    await expect(send).toBeDisabled();
    // A draft needs no subject: only sending waits for it.
    await expect(save).toBeEnabled();
    saw('STX-033');

    await subject.fill('Lunch moved');
    await expect(input.getByText('Add a subject', { exact: true })).toHaveCount(
      0
    );
    await expect(send).toBeEnabled();

    // A pasted thread link becomes context attached to the request, which an
    // email cannot carry.
    const attached =
      'Attached context is supported for AI. Remove it or choose AI.';
    await pasteIntoRequest(
      page,
      `${mailbox.front.origin}/app/mail/${thread.id}`
    );
    await expect(
      input.getByText('1 attached item(s) · AI context')
    ).toBeVisible();
    await expect(input.getByText(attached, { exact: true })).toBeVisible();
    await expect(send).toBeDisabled();
    await expect(save).toBeDisabled();
    saw('STX-033');

    await input.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(input.getByText(attached, { exact: true })).toHaveCount(0);
    await expect(send).toBeEnabled();
    await expect(save).toBeEnabled();

    // With the inbox gone, the same email has no account to go from.
    await disconnectInbox(mailbox);
    await mailbox.open('/app/mail');
    await openUniversalInput(page);
    await chooseEmail(page);
    await expect(
      input.getByText(
        'Connect Google to send email and create calendar events. Then return here to compose.'
      )
    ).toBeVisible();
    await expect(
      input.getByRole('button', { name: 'Connect Google' })
    ).toBeVisible();
    saw('STX-301');

    await addRecipient(page, 'bob@example.com');
    await subject.fill('Lunch moved');
    await expect(
      input.getByText('Connect or choose an email account', { exact: true })
    ).toBeVisible();
    await expect(send).toBeDisabled();
    await expect(save).toBeDisabled();
    saw('STX-033');
  });
});
