// The new-email composer on a desktop before it sends: the hints of an empty
// form, what each refused send names, the toolbar before a draft exists, the
// From of a single inbox, a file dragged over the body, a file attached
// offline, and a chosen sending inbox that was removed elsewhere.

import { body, loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { anInbox, PROVIDERS } from './harness/providers';
import {
  chooseFileToAttach,
  dragFile,
  returnToTab,
  toolbarButtons,
} from './harness/states-compose';
import { saw } from './ledger/record';

const WORK = 'ada.work@example.com';

test.beforeEach(({ page }) => loadAppSteadily(page));

// When this fails, an empty new email no longer hints what goes in the
// recipient field or the body, the toolbar offers to delete a draft that
// does not exist, the recipient field does not say that nothing matched,
// or Send refuses an incomplete email without naming what is missing. The
// same code serves every mailbox, so it runs on Gmail only.
test('an empty new email hints at each field, and each refused send names what is missing', async ({
  page,
  mailbox,
}) => {
  await mailbox.open('/app/mail/new');
  const to = page.getByRole('combobox', {
    name: 'Macro users or email addresses',
  });
  await expect(to).toBeVisible();
  await expect(to).toHaveValue('');
  saw('STC-005');
  await expect(
    page.getByText('Use `@` to reference files', { exact: true })
  ).toBeVisible();
  saw('STC-007');
  // Only Attach comes before Insert image: there is no trash yet.
  const buttons = toolbarButtons(page);
  await expect(buttons.nth(1)).toHaveAccessibleName('Insert image');
  saw('STC-316');
  const send = page.getByRole('button', { name: 'Send email', exact: true });
  await expect(send).toBeVisible();
  saw('STC-049', 'F-131');

  await to.fill('zz');
  await expect(page.getByText('No matching options.')).toBeVisible();
  saw('STC-313');
  await to.fill('');

  await send.click();
  await page.mouse.move(0, 0);
  const noRecipient = page.getByText('Please select at least one recipient');
  await expect(noRecipient).toBeVisible();
  saw('STC-013');

  await to.fill('grace@example.com');
  await to.press('Enter');
  await send.click();
  await page.mouse.move(0, 0);
  await expect(noRecipient).toBeHidden();
  const noMessage = page.getByText('Please enter a message');
  await expect(noMessage).toBeVisible();
  saw('STC-014');

  await body(page).click();
  await page.keyboard.type('Hello there.');
  await send.click();
  await page.mouse.move(0, 0);
  await expect(noMessage).toBeHidden();
  await expect(page.getByText('Please enter a subject')).toBeVisible();
  saw('STC-015');
  // The recipient made a draft: now the trash stands before Attach.
  await expect(buttons.nth(2)).toHaveAccessibleName('Insert image');
});

for (const provider of PROVIDERS) {
  test.describe(`a new email in ${anInbox(provider)}`, () => {
    test.use({ provider });

    // When this fails, a user with one inbox is offered a From menu with
    // nothing else to choose, a file dragged over the body is not offered a
    // place to drop, or a file attached offline is taken without warning
    // that it cannot be added. Which senders exist is the provider's data.
    test('From is the one inbox as text, a dragged file is offered a drop, and an offline attach is refused', async ({
      page,
      mailbox,
    }) => {
      await mailbox.open('/app/mail/new');
      const sender = page.getByRole('group', { name: 'Sending inbox' });
      await expect(sender.getByText(mailbox.inbox.email)).toBeVisible();
      await expect(sender.getByRole('button')).toHaveCount(0);
      saw('STC-306');

      const drop = page.getByText('Drop file(s) to attach');
      await dragFile(body(page), ['dragenter', 'dragover']);
      await expect(drop).toBeVisible();
      saw('STC-010');
      await dragFile(body(page), ['dragleave']);
      await expect(drop).toBeHidden();

      await page.context().setOffline(true);
      await chooseFileToAttach(page, toolbarButtons(page).first(), {
        name: 'notes.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('notes'),
      });
      await expect(
        page.getByRole('heading', { name: "You're offline" })
      ).toBeVisible();
      await expect(
        page.getByText(
          "Attachments can't be added while you're offline. Reconnect and try again."
        )
      ).toBeVisible();
      saw('STC-022');
      await page.context().setOffline(false);
      await page.getByRole('button', { name: 'OK', exact: true }).click();
      await expect(page.getByText('notes.txt')).toHaveCount(0);
    });
  });
}

// When this fails, a composer whose chosen sending inbox was removed in
// another tab still shows that inbox as its From, or Send tries to send
// without one instead of asking for a sending inbox. The composer's own
// state, the same whatever the provider: Gmail only.
test('a chosen sending inbox removed elsewhere leaves From asking for one, and Send says so', async ({
  page,
  mailbox,
}) => {
  const work = await mailbox.stack.link(mailbox.user, 'GMAIL', WORK);
  await mailbox.open('/app/mail/new');
  const from = page.getByRole('button', { name: 'From address' });
  await from.click();
  await page.getByRole('menuitem').filter({ hasText: WORK }).click();
  await expect(from).toContainText(WORK);

  const removed = await mailbox.api(`/email/email/links/${work.linkId}`, {
    method: 'DELETE',
  });
  expect(removed.status).toBe(204);
  await returnToTab(page);
  const ask = page.getByRole('button', { name: 'Select sending inbox' });
  await expect(ask).toContainText('Select sending inbox');
  saw('STC-006');

  const to = page.getByRole('combobox').first();
  await to.fill('grace@example.com');
  await to.press('Enter');
  await page.getByPlaceholder(/subject/i).fill('Nowhere to send from');
  await body(page).click();
  await page.keyboard.type('Which inbox?');
  await page.getByRole('button', { name: 'Send email', exact: true }).click();
  await page.mouse.move(0, 0);
  await expect(page.getByRole('alert')).toHaveText(
    'Unable to find linked email account. Select a sending inbox.'
  );
  saw('STC-016');
});
