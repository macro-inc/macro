// What an open saved view shows around its list: Save changes and Reset
// while it has edits, Save changes waiting or refused, a save the service
// refused (with Reload on a conflict), settings this version skipped, a view
// that is gone, and the reason the list's filters cannot be saved.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { rowIds } from './harness/list';
import { anInbox, PROVIDERS } from './harness/providers';
import {
  addPeopleDomain,
  chooseAlias,
  linkAliasInbox,
  OperationGate,
  onlyReadMail,
  refusal,
} from './harness/states-saved-views';
import { backfilled } from './harness/states-send2';
import {
  changeStoredView,
  storeView,
  viewRow,
} from './harness/ways-saved-views';
import { saw } from './ledger/record';

const from = 'Grace <grace@example.com>';
const ALIAS_REFUSAL = 'Choose an inbox instead of an alias to save this view.';

for (const provider of PROVIDERS) {
  test.describe(`an open saved view's states, with ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, an edited view offers no Save changes or Reset, Save
    // changes can be pressed again while it saves or on a view whose skipped
    // settings it would lose, a refused save says nothing or offers no way
    // on (Reload on a conflict, Duplicate), a view with settings this version
    // cannot apply does not say so, or a view that is gone shows mail anyway.
    test('an edited view offers Save changes, waits while it saves, and says why a save or the view failed', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({ from, subject: 'Alpha', text: 'Body of Alpha.' });
      const alpha = await mailbox.synced('Alpha');
      await storeView(mailbox, 'Alpha mail', { subject: ['Alpha'] });
      await storeView(mailbox, 'Odd view', {
        subject: ['Alpha'],
        importance: 'urgent-only',
      });
      const update = await OperationGate.on(page, 'UpdateSavedView');
      const actions = page.getByRole('group', { name: 'Saved view actions' });
      const saveChanges = actions.getByRole('button', { name: 'Save changes' });
      const refused = page.getByRole('group', {
        name: 'Saved view save error',
      });

      // A link to a view the service has never held.
      await mailbox.open(
        `/app/mail?s0.mail.savedView=${crypto.randomUUID()}&s0.mail.tab=all`
      );
      await expect(
        page
          .getByRole('alert')
          .filter({ hasText: 'This saved view is unavailable' })
      ).toHaveText(
        'This saved view is unavailable or you no longer have access.'
      );
      await expect(
        page.getByRole('button', { name: 'Return to Email' })
      ).toBeVisible();
      saw('STL-063');
      expect(await rowIds(page)).toEqual([]);

      await viewRow(page, 'Alpha mail').click();
      await expect.poll(() => rowIds(page)).toEqual([alpha.id]);
      await expect(actions).toHaveCount(0);

      // Alpha is unread: the edited view lists nothing.
      await onlyReadMail(page);
      await expect.poll(() => rowIds(page)).toEqual([]);
      await expect(saveChanges).toBeEnabled();
      await expect(
        actions.getByRole('button', { name: 'Reset' })
      ).toBeVisible();
      saw('STL-061');

      // The service refuses the save.
      update.refuse(refusal('This saved view cannot be changed right now.'));
      await saveChanges.click();
      await expect(refused.getByRole('alert')).toHaveText(
        'This saved view cannot be changed right now.'
      );
      await expect(
        refused.getByRole('button', { name: 'Duplicate' })
      ).toBeVisible();
      await expect(
        refused.getByRole('button', { name: 'Reload saved view' })
      ).toHaveCount(0);
      saw('STL-062');

      // Saved again, held on its way while the view changes elsewhere.
      update.hold();
      await saveChanges.click();
      await expect.poll(() => update.held).toBe(1);
      await expect(saveChanges).toBeDisabled();
      saw('STL-713');
      await changeStoredView(mailbox, 'Alpha mail', { subject: ['Beta'] });
      update.pass();
      await expect(
        refused.getByRole('button', { name: 'Reload saved view' })
      ).toBeVisible();
      await expect(refused.getByRole('alert')).not.toHaveText(
        'This saved view cannot be changed right now.'
      );
      await expect(
        refused.getByRole('button', { name: 'Duplicate' })
      ).toBeVisible();
      saw('STL-062');
      await expect(saveChanges).toBeEnabled();

      // A view with an importance this version does not know.
      await actions.getByRole('button', { name: 'Reset' }).click();
      await expect(actions).toHaveCount(0);
      await viewRow(page, 'Odd view').click();
      const skipped = page
        .getByRole('alert')
        .filter({ hasText: 'Some saved settings were skipped.' });
      await expect(skipped).toContainText('Skipped settings: Importance');
      saw('STL-064');
      await onlyReadMail(page);
      await expect(
        actions.getByRole('button', { name: 'Reset' })
      ).toBeVisible();
      await expect(saveChanges).toBeDisabled();
      saw('STL-713');
    });
  });
}

// Gmail only: the one filter the list shows that a view cannot hold is a
// send-as alias together with people, and aliases come from a Google
// account's settings.
test.describe('saving the filters of an alias with people, with a Gmail inbox', () => {
  test.use({ provider: 'GMAIL' });
  // "Inbox synced", raised when an inbox's first backfill is announced,
  // stacks on the refusal's notice and covers its Close button. A page
  // opened after both inboxes' backfills never hears of them; the second
  // inbox is linked first, so that the two run at once.
  test.beforeEach(async ({ page, mailbox }) => {
    const alias = await linkAliasInbox(mailbox);
    await backfilled(mailbox);
    await backfilled(mailbox, alias);
    await loadAppSteadily(page);
  });

  // When this fails, Save view or Save changes on filters a view cannot
  // hold opens nothing and says nothing, or opens the builder on a view it
  // cannot save.
  test('Save view and Save changes say why the filters of an alias with people cannot be saved', async ({
    page,
    mailbox,
  }) => {
    await storeView(mailbox, 'Alpha mail', { subject: ['Alpha'] });
    const toast = page.getByRole('status').filter({ hasText: ALIAS_REFUSAL });

    await mailbox.open();
    await expect(viewRow(page, 'Alpha mail')).toBeVisible();

    // The Signal tab, narrowed to the alias and the people of a domain.
    await chooseAlias(page);
    await addPeopleDomain(page, 'example.com');
    await page
      .getByRole('group', { name: 'Saved view actions' })
      .getByRole('button', { name: 'Save view', exact: true })
      .click();
    await expect(toast).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Save view' })).toHaveCount(
      0
    );
    saw('STL-060');
    await toast.getByRole('button', { name: 'Close' }).click();
    await expect(toast).toHaveCount(0);

    // The open view, narrowed the same way.
    await viewRow(page, 'Alpha mail').click();
    await expect(viewRow(page, 'Alpha mail')).toHaveAttribute(
      'aria-current',
      'page'
    );
    await chooseAlias(page);
    await addPeopleDomain(page, 'example.com');
    await page
      .getByRole('group', { name: 'Saved view actions' })
      .getByRole('button', { name: 'Save changes' })
      .click();
    await expect(toast).toBeVisible();
    saw('STL-700');
  });
});
