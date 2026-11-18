// The buttons an open saved view grows once its filters are edited: Save
// changes and Reset beside them, and, after a save the service refused
// because the view changed elsewhere, Reload saved view and Duplicate.
// Each for a Gmail and an Outlook inbox.

import type { Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { rowIds } from './harness/list';
import { anInbox, PROVIDERS } from './harness/providers';
import {
  changeStoredView,
  closeMenus,
  storedNames,
  storedView,
  storeView,
  viewRow,
} from './harness/ways-saved-views';
import { did } from './ledger/record';

const from = 'Grace <grace@example.com>';

/** Edits the open view through the list's Filters menu: read mail only. */
async function onlyReadMail(page: Page): Promise<void> {
  await page
    .getByRole('group', { name: 'Email filters' })
    .getByRole('button', { name: 'Filter email' })
    .click();
  await page.getByRole('menuitem', { name: 'Read status' }).click();
  await page.getByRole('menuitemradio', { name: 'Read', exact: true }).click();
  await closeMenus(page);
}

for (const provider of PROVIDERS) {
  test.describe(`an edited saved view of ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, Reset leaves the open view's edits on the list, or
    // Save changes does not store them: the view opens with its old filters
    // the next time.
    test('Reset drops the edits of an open view and Save changes stores them', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({ from, subject: 'Alpha', text: 'Body of Alpha.' });
      await mailbox.deliver({ from, subject: 'Beta', text: 'Body of Beta.' });
      const alpha = await mailbox.synced('Alpha');
      await mailbox.synced('Beta');
      await storeView(mailbox, 'Alpha mail', { subject: ['Alpha'] });
      const actions = page.getByRole('group', { name: 'Saved view actions' });

      await mailbox.open();
      await viewRow(page, 'Alpha mail').click();
      await expect.poll(() => rowIds(page)).toEqual([alpha.id]);
      await expect(actions).toHaveCount(0);

      // Alpha is unread: the edited view lists nothing.
      await onlyReadMail(page);
      await expect.poll(() => rowIds(page)).toEqual([]);
      await actions.getByRole('button', { name: 'Reset' }).click();
      did('AL-117');
      await expect.poll(() => rowIds(page)).toEqual([alpha.id]);
      await expect(actions).toHaveCount(0);
      expect(
        (await storedView(mailbox, 'Alpha mail'))?.filters.read
      ).toBeUndefined();

      await onlyReadMail(page);
      await expect.poll(() => rowIds(page)).toEqual([]);
      await actions.getByRole('button', { name: 'Save changes' }).click();
      did('AL-116');
      await expect
        .poll(async () => (await storedView(mailbox, 'Alpha mail'))?.filters)
        .toMatchObject({ read: 'read', subject: ['Alpha'] });
      // Saved, the view has no edits left, and still lists what it names.
      await expect(actions).toHaveCount(0);
      await expect.poll(() => rowIds(page)).toEqual([]);
      await expect(viewRow(page, 'Alpha mail')).toHaveAttribute(
        'aria-current',
        'page'
      );
    });

    // When this fails, a view that changed elsewhere cannot be saved and
    // offers no way on: Reload saved view does not bring the newer view, or
    // Duplicate does not keep the edits as a view of their own.
    test('after a refused save, Reload brings the newer view and Duplicate keeps the edits as a copy', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({ from, subject: 'Alpha', text: 'Body of Alpha.' });
      await mailbox.deliver({ from, subject: 'Beta', text: 'Body of Beta.' });
      const alpha = await mailbox.synced('Alpha');
      const beta = await mailbox.synced('Beta');
      await storeView(mailbox, 'My mail', { subject: ['Alpha'] });
      const actions = page.getByRole('group', { name: 'Saved view actions' });
      const refused = page.getByRole('group', {
        name: 'Saved view save error',
      });
      const copier = page.getByRole('dialog', { name: 'Duplicate saved view' });

      await mailbox.open();
      await viewRow(page, 'My mail').click();
      await expect.poll(() => rowIds(page)).toEqual([alpha.id]);

      // The view is changed elsewhere while it is edited here.
      await onlyReadMail(page);
      await expect.poll(() => rowIds(page)).toEqual([]);
      await changeStoredView(mailbox, 'My mail', { subject: ['Beta'] });
      await actions.getByRole('button', { name: 'Save changes' }).click();
      await expect(refused.getByRole('alert')).toBeVisible();
      await refused.getByRole('button', { name: 'Reload saved view' }).click();
      did('AL-118');
      // The newer view, without the edits: mail about Beta, read or not.
      await expect.poll(() => rowIds(page)).toEqual([beta.id]);
      await expect(refused).toHaveCount(0);
      await expect(actions).toHaveCount(0);

      await onlyReadMail(page);
      await expect.poll(() => rowIds(page)).toEqual([]);
      await changeStoredView(mailbox, 'My mail', { subject: ['Alpha'] });
      await actions.getByRole('button', { name: 'Save changes' }).click();
      await expect(refused.getByRole('alert')).toBeVisible();
      await refused.getByRole('button', { name: 'Duplicate' }).click();
      did('AL-708');
      await expect(copier.getByRole('textbox', { name: 'Name' })).toHaveValue(
        'My mail (copy)'
      );
      await copier.getByRole('button', { name: 'Duplicate' }).click();
      await expect(copier).toHaveCount(0);
      // The copy holds what the list showed: Beta, read mail only.
      await expect
        .poll(
          async () => (await storedView(mailbox, 'My mail (copy)'))?.filters
        )
        .toMatchObject({ read: 'read', subject: ['Beta'] });
      expect((await storedNames(mailbox)).sort()).toEqual([
        'My mail',
        'My mail (copy)',
      ]);
      await expect(viewRow(page, 'My mail (copy)')).toHaveAttribute(
        'aria-current',
        'page'
      );
      await expect.poll(() => rowIds(page)).toEqual([]);
    });
  });
}
