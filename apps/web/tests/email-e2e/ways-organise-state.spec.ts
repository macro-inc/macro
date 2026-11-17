// Every way into a thread's done state and into Trash besides the shortcut
// and the row button: the row's context menu, the selection toolbar's
// command menu, the open thread's header button and the menu after its
// subject. Each for a Gmail and an Outlook inbox.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { trashFolder } from './harness/journeys';
import { rowIds } from './harness/list';
import { anInbox, PROVIDERS } from './harness/providers';
import {
  backToList,
  commandAction,
  deliverAll,
  held,
  openFromList,
  row,
  rowMenu,
  selectRows,
  titleMenu,
} from './harness/ways-organise';
import { inInboxAt } from './harness/ways-organise-more';
import { did } from './ledger/record';

for (const provider of PROVIDERS) {
  test.describe(`the ways into a thread's state in ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, Mark Done or Mark Not Done in the row's menu, on the
    // open thread's check button or in the menu after its subject, or Mark
    // done in the command menu the selection toolbar's Actions opens, does
    // nothing at the mailbox: the thread stays in (or out of) the inbox.
    test('every way to mark a thread done, and not done again', async ({
      page,
      mailbox,
    }) => {
      const ids = await deliverAll(mailbox, [
        'Agenda',
        'Minutes',
        'Budget',
        'Lunch',
        'Notes',
      ]);
      const header = page.getByRole('group', { name: 'Email actions' });
      const library = page.getByRole('navigation', { name: 'Email library' });
      const search = page.getByRole('textbox', { name: 'Search actions...' });

      await mailbox.open();
      await expect
        .poll(() => rowIds(page))
        .toEqual(expect.arrayContaining(Object.values(ids)));
      await rowMenu(page, ids.Agenda, /^Mark Done/);
      did('AL-078', 'F-071');
      await expect.poll(inInboxAt(mailbox, 'Agenda')).toBe(false);

      // Two threads at once, from the toolbar's Actions.
      await selectRows(page, [ids.Lunch, ids.Notes]);
      await page.getByRole('button', { name: /^Actions/ }).click();
      did('AL-092');
      await expect(search).toBeVisible();
      await commandAction(page, 'done', /^Mark done/);
      did('AL-601');
      await expect.poll(inInboxAt(mailbox, 'Lunch')).toBe(false);
      await expect.poll(inInboxAt(mailbox, 'Notes')).toBe(false);

      await openFromList(page, ids.Minutes, 'About Minutes.');
      await header.getByRole('button', { name: 'Mark done' }).click();
      did('AL-127', 'F-071');
      await expect.poll(inInboxAt(mailbox, 'Minutes')).toBe(false);
      await backToList(page);

      await openFromList(page, ids.Budget, 'About Budget.');
      await titleMenu(page, 'Budget', /^Mark Done/);
      did('AL-150', 'F-071');
      await expect.poll(inInboxAt(mailbox, 'Budget')).toBe(false);
      await backToList(page);

      await library.getByRole('button', { name: 'Archived' }).click();
      await expect(page).toHaveURL(/tab=archived/);
      await expect
        .poll(() => rowIds(page))
        .toEqual(expect.arrayContaining(Object.values(ids)));
      await rowMenu(page, ids.Agenda, /^Mark Not Done/);
      did('AL-078', 'F-072');
      await expect.poll(inInboxAt(mailbox, 'Agenda')).toBe(true);

      await openFromList(page, ids.Minutes, 'About Minutes.');
      await header.getByRole('button', { name: 'Mark as not done' }).click();
      did('AL-127', 'F-072');
      await expect.poll(inInboxAt(mailbox, 'Minutes')).toBe(true);
      await backToList(page);

      await openFromList(page, ids.Budget, 'About Budget.');
      await titleMenu(page, 'Budget', /^Mark Not Done/);
      did('AL-150', 'F-072');
      await expect.poll(inInboxAt(mailbox, 'Budget')).toBe(true);
    });

    // When this fails, Delete in the row's menu, in the command menu of a
    // selection or in the menu after an open thread's subject leaves the
    // message out of the mailbox's Trash.
    test('every way to move a thread to Trash', async ({ page, mailbox }) => {
      const ids = await deliverAll(mailbox, [
        'Agenda',
        'Minutes',
        'Budget',
        'Kept',
      ]);
      const labels = (subject: string) => async () =>
        (await held(mailbox, subject))?.labels;

      await mailbox.open();
      await expect
        .poll(() => rowIds(page))
        .toEqual(expect.arrayContaining(Object.values(ids)));
      await rowMenu(page, ids.Agenda, /^Delete/);
      did('AL-089');
      await expect.poll(labels('Agenda')).toContain(trashFolder(provider));
      await expect(row(page, ids.Agenda)).toHaveCount(0);

      await selectRows(page, [ids.Minutes]);
      await page.getByRole('button', { name: /^Actions/ }).click();
      await commandAction(page, 'delete', /^Delete item/);
      did('AL-611');
      await expect.poll(labels('Minutes')).toContain(trashFolder(provider));
      await expect(row(page, ids.Minutes)).toHaveCount(0);

      await openFromList(page, ids.Budget, 'About Budget.');
      await titleMenu(page, 'Budget', /^Delete/);
      did('AL-157');
      await expect.poll(labels('Budget')).toContain(trashFolder(provider));

      // The one nobody deleted is still where it was.
      expect((await labels('Kept')())?.includes(trashFolder(provider))).toBe(
        false
      );
    });
  });
}
