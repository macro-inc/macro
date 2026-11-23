// The saved view builder beyond its name and subject: the tag picker, the
// conditions under Advanced settings, and Cancel, in a new view (which Cancel
// leaves in the sidebar as a draft) and in the edit of one. Each for a Gmail
// and an Outlook inbox.

import type { Locator } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { rowIds } from './harness/list';
import { createTag, tagThread } from './harness/organise';
import { anInbox, PROVIDERS } from './harness/providers';
import {
  listedNames,
  storedNames,
  storedView,
  viewList,
  viewRow,
} from './harness/ways-saved-views';
import { did } from './ledger/record';

const from = 'Grace <grace@example.com>';

/** Picks one value of a condition under Advanced settings. */
async function choose(
  builder: Locator,
  condition: string,
  value: string
): Promise<void> {
  await builder
    .getByRole('radiogroup', { name: condition })
    .getByText(value, { exact: true })
    .click();
}

for (const provider of PROVIDERS) {
  test.describe(`the saved view builder, with ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, the builder's tag picker or one of its advanced
    // conditions does not reach the saved view (the view lists mail it
    // should not), Cancel saves what it was asked to drop, or the draft a
    // cancelled new view leaves cannot be discarded for the next new view.
    test('tags and advanced conditions are saved with a view, and Cancel saves nothing', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({ from, subject: 'Alpha', text: 'Body of Alpha.' });
      await mailbox.deliver({ from, subject: 'Beta', text: 'Body of Beta.' });
      const alpha = await mailbox.synced('Alpha');
      const beta = await mailbox.synced('Beta');
      const urgent = await createTag(mailbox, 'Urgent');
      await tagThread(mailbox, alpha.id, urgent);
      const builder = page.getByRole('dialog', { name: 'Save view' });
      const editor = page.getByRole('dialog', { name: 'Edit “Tagged”' });
      const draft = viewList(page).getByRole('button', {
        name: 'Dropped, Draft',
        exact: true,
      });
      const leaving = page
        .getByRole('alertdialog')
        .or(page.getByRole('dialog'))
        .filter({ hasText: 'Discard unsaved changes?' });
      const edit = async () => {
        await page.getByRole('button', { name: 'Saved view actions' }).click();
        await page.getByRole('menuitem', { name: 'Edit' }).click();
        await expect(editor.getByRole('textbox', { name: 'Name' })).toHaveValue(
          'Tagged'
        );
      };

      await mailbox.open();
      await expect.poll(() => rowIds(page)).toEqual([beta.id, alpha.id]);

      // A new view, cancelled: nothing is saved. The builder closes on the
      // view's draft, which stays in the sidebar under the name it was given.
      await page.getByRole('button', { name: 'New saved view' }).click();
      await builder.getByRole('textbox', { name: 'Name' }).fill('Dropped');
      await builder.getByRole('button', { name: 'Cancel' }).click();
      did('AL-706', 'F-045');
      await expect(builder).toHaveCount(0);
      await expect(draft).toHaveAttribute('aria-current', 'page');
      await expect(page).not.toHaveURL(/savedView=/);
      await expect.poll(() => rowIds(page)).toEqual([beta.id, alpha.id]);
      expect(await storedNames(mailbox)).toEqual([]);

      // The next new view asks before it takes the named draft's place.
      // Discarded, the draft is saved nowhere, and the builder opens on a
      // view of its own.
      await page.getByRole('button', { name: 'New saved view' }).click();
      await expect(leaving).toBeVisible();
      await leaving.getByRole('button', { name: 'Discard' }).click();
      await expect(builder.getByRole('textbox', { name: 'Name' })).toHaveValue(
        'New view'
      );
      expect(await storedNames(mailbox)).toEqual([]);

      // A new view of unread mail tagged Urgent, from the last week.
      await builder.getByRole('textbox', { name: 'Name' }).fill('Tagged');
      await builder.getByRole('combobox', { name: 'Tags' }).click();
      await page.getByRole('option', { name: 'Urgent' }).click();
      did('AL-704', 'F-045');
      await builder.getByRole('button', { name: 'Advanced settings' }).click();
      await choose(builder, 'Read status', 'Unread');
      await choose(builder, 'Latest activity', 'Last 7 days');
      did('AL-705', 'F-045');
      await builder.getByRole('button', { name: 'Save view' }).click();
      await expect(builder).toHaveCount(0);
      await expect(viewRow(page, 'Tagged')).toHaveAttribute(
        'aria-current',
        'page'
      );
      // The saved view is the only one listed: the discarded draft is gone.
      await expect.poll(() => listedNames(page)).toEqual(['Tagged']);
      await expect.poll(() => rowIds(page)).toEqual([alpha.id]);
      await expect
        .poll(async () => (await storedView(mailbox, 'Tagged'))?.filters)
        .toMatchObject({
          tags: [
            {
              optionId: urgent.optionId,
              propertyDefinitionId: urgent.definitionId,
            },
          ],
          read: 'unread',
          receivedWithinDays: 7,
        });
      // The service holds that view alone: neither Cancel nor Discard saved
      // the draft after all.
      expect(await storedNames(mailbox)).toEqual(['Tagged']);

      // Its edit, cancelled: the tag taken out in the builder stays saved.
      await edit();
      await editor.getByRole('button', { name: 'Remove Urgent' }).click();
      await editor.getByRole('button', { name: 'Cancel' }).click();
      did('AL-706', 'F-047');
      await expect(editor).toHaveCount(0);
      await expect.poll(() => rowIds(page)).toEqual([alpha.id]);
      expect((await storedView(mailbox, 'Tagged'))?.filters.tags).toHaveLength(
        1
      );

      // Its edit, saved: no tag, and mail that is not done, read or not.
      await edit();
      await editor.getByRole('button', { name: 'Remove Urgent' }).click();
      did('AL-704', 'F-047');
      // The view has advanced conditions, so they are shown: the toggle
      // folds them away and brings them back.
      const advanced = editor.getByRole('button', {
        name: 'Advanced settings',
      });
      await expect(advanced).toHaveAttribute('aria-expanded', 'true');
      await advanced.click();
      await expect(advanced).toHaveAttribute('aria-expanded', 'false');
      await advanced.click();
      await choose(editor, 'Read status', 'Any');
      await choose(editor, 'Done', 'Not done');
      did('AL-705', 'F-047');
      await editor.getByRole('button', { name: 'Save changes' }).click();
      await expect(editor).toHaveCount(0);
      await expect.poll(() => rowIds(page)).toEqual([beta.id, alpha.id]);
      await expect
        .poll(async () => (await storedView(mailbox, 'Tagged'))?.filters)
        .toMatchObject({ tags: [], done: 'not-done', receivedWithinDays: 7 });
      expect(
        (await storedView(mailbox, 'Tagged'))?.filters.read
      ).toBeUndefined();
    });
  });
}
