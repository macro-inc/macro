// What the saved view builder shows besides its fields' values: which
// pickers it offers, when Advanced settings start open, when its submit
// button waits, and a save the service refused, in a new view and in the
// edit of one. Each for a Gmail and an Outlook inbox.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { rowIds } from './harness/list';
import { createTag } from './harness/organise';
import { anInbox, PROVIDERS } from './harness/providers';
import { OperationGate, refusal, WORK } from './harness/states-saved-views';
import { storedNames, viewRow } from './harness/ways-saved-views';
import { saw } from './ledger/record';

const from = 'Grace <grace@example.com>';

/** More subject conditions than a saved view holds (twenty). */
const TOO_MANY_SUBJECTS = Array.from(
  { length: 21 },
  (_, index) => `Word ${index + 1}`
).join(', ');

for (const provider of PROVIDERS) {
  test.describe(`the saved view builder's states, with ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, the builder hides the Tags or Inboxes picker that
    // there is something to pick in (or shows an empty one), folds away the
    // conditions a view being edited has, lets a view without a name or with
    // a definition the service refuses be submitted, can be submitted twice
    // while it saves, or closes on a refused save without saying why.
    test('the builder offers what there is to pick, waits while it saves, and says why a save was refused', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({ from, subject: 'Alpha', text: 'Body of Alpha.' });
      const alpha = await mailbox.synced('Alpha');
      const create = await OperationGate.on(page, 'CreateSavedView');
      const update = await OperationGate.on(page, 'UpdateSavedView');
      const builder = page.getByRole('dialog', { name: 'Save view' });
      const editor = page.getByRole('dialog', { name: 'Edit “Alpha mail”' });
      const name = builder.getByRole('textbox', { name: 'Name' });
      const advanced = builder.getByRole('button', {
        name: 'Advanced settings',
      });
      const submit = builder.getByRole('button', {
        name: 'Save view',
        exact: true,
      });

      await mailbox.open();
      await expect.poll(() => rowIds(page)).toEqual([alpha.id]);

      // One inbox and no tags: neither picker, and the conditions folded.
      await page.getByRole('button', { name: 'New saved view' }).click();
      await expect(name).toHaveValue('New view');
      await expect(advanced).toHaveAttribute('aria-expanded', 'false');
      await expect(builder.getByRole('combobox', { name: 'Tags' })).toHaveCount(
        0
      );
      await advanced.click();
      await expect(
        builder.getByRole('radiogroup', { name: 'Read status' })
      ).toBeVisible();
      await expect(builder.getByRole('group', { name: 'Inboxes' })).toHaveCount(
        0
      );
      await builder.getByRole('button', { name: 'Cancel' }).click();
      await expect(builder).toHaveCount(0);

      // A tag and a second inbox, seen by the app after a reload.
      await createTag(mailbox, 'Urgent');
      await mailbox.stack.link(mailbox.user, provider, WORK);
      await page.reload();
      await expect.poll(() => rowIds(page)).toEqual([alpha.id]);
      await page.getByRole('button', { name: 'New saved view' }).click();
      await expect(
        builder.getByRole('combobox', { name: 'Tags' })
      ).toBeVisible();
      await expect(advanced).toHaveAttribute('aria-expanded', 'false');
      await advanced.click();
      const inboxes = builder.getByRole('group', { name: 'Inboxes' });
      await expect(inboxes).toBeVisible();
      await expect(inboxes.getByRole('checkbox')).toHaveCount(2);
      await expect(inboxes.getByRole('checkbox', { name: WORK })).toHaveCount(
        1
      );
      saw('STL-708', 'F-045');

      // No name, then more subjects than a view holds: nothing to submit.
      await name.fill('');
      await expect(submit).toBeDisabled();
      await name.fill('Alpha mail');
      await expect(submit).toBeEnabled();
      const subject = builder.getByRole('textbox', {
        name: 'Subject contains',
      });
      await subject.fill(TOO_MANY_SUBJECTS);
      await expect(submit).toBeDisabled();
      await subject.fill('Alpha');
      await expect(submit).toBeEnabled();
      saw('STL-706', 'F-045');
      await builder
        .getByRole('radiogroup', { name: 'Read status' })
        .getByText('Unread', { exact: true })
        .click();

      // The service refuses the new view.
      create.refuse(refusal('Saved views cannot be created right now.'));
      await submit.click();
      await expect(builder.getByRole('alert')).toHaveText(
        'Saved views cannot be created right now.'
      );
      saw('STL-707', 'F-045');

      // Saved again, held on its way.
      create.hold();
      await submit.click();
      await expect.poll(() => create.held).toBe(1);
      await expect(
        builder.getByRole('button', { name: 'Saving…' })
      ).toBeDisabled();
      saw('STL-706', 'F-045');
      create.pass();
      await expect(builder).toHaveCount(0);
      await expect(viewRow(page, 'Alpha mail')).toHaveAttribute(
        'aria-current',
        'page'
      );
      expect(await storedNames(mailbox)).toEqual(['Alpha mail']);

      // Its edit: the view sets a read status, so Advanced settings start open.
      await page
        .getByRole('button', { name: 'Actions for Alpha mail', exact: true })
        .click();
      await page.getByRole('menuitem', { name: 'Edit' }).click();
      await expect(
        editor.getByRole('button', { name: 'Advanced settings' })
      ).toHaveAttribute('aria-expanded', 'true');
      await expect(
        editor.getByRole('radiogroup', { name: 'Read status' })
      ).toBeVisible();
      saw('STL-708', 'F-047');

      const editName = editor.getByRole('textbox', { name: 'Name' });
      const saveChanges = editor.getByRole('button', { name: 'Save changes' });
      await editName.fill('');
      await expect(saveChanges).toBeDisabled();
      await editName.fill('Alpha only');
      await expect(saveChanges).toBeEnabled();
      saw('STL-706', 'F-047');

      update.refuse(refusal('This saved view cannot be changed right now.'));
      await saveChanges.click();
      await expect(editor.getByRole('alert')).toHaveText(
        'This saved view cannot be changed right now.'
      );
      saw('STL-707', 'F-047');

      update.hold();
      await saveChanges.click();
      await expect.poll(() => update.held).toBe(1);
      await expect(
        editor.getByRole('button', { name: 'Saving…' })
      ).toBeDisabled();
      saw('STL-706', 'F-047');
      update.pass();
      await expect(editor).toHaveCount(0);
      await expect(viewRow(page, 'Alpha only')).toBeVisible();
      expect(await storedNames(mailbox)).toEqual(['Alpha only']);
    });
  });
}
