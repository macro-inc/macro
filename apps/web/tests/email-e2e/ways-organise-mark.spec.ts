// Every way to mark a thread read or unread, and to favorite it, besides the
// shortcut and the row button: the row's context menu, the selection
// toolbar's command menu, the open thread's envelope button and the menu
// after its subject. Each for a Gmail and an Outlook inbox.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { openThreadId, rowIds, seenRequestsInFlight } from './harness/list';
import { anInbox, PROVIDERS } from './harness/providers';
import { notice } from './harness/send';
import {
  commandAction,
  deliverAll,
  favorites,
  openFromList,
  row,
  rowMenu,
  selectRows,
  titleMenu,
} from './harness/ways-organise';
import { CLEAR, readAt, toolbarButton } from './harness/ways-organise-more';
import { did } from './ledger/record';

for (const provider of PROVIDERS) {
  test.describe(`marking a thread of ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, Mark Read or Mark Unread in the row's menu, or Mark
    // as unread on the open thread's envelope button or in the menu after
    // its subject, leaves the message as it was at the mailbox.
    test('every way to mark a thread read, and unread', async ({
      page,
      mailbox,
    }) => {
      const ids = await deliverAll(mailbox, ['Agenda', 'Minutes', 'Budget']);
      const read = (subject: string) => readAt(mailbox, subject);
      const header = page.getByRole('group', { name: 'Email actions' });
      const seenInFlight = seenRequestsInFlight(page);
      // Opening a thread marks it read: that has reached the mailbox before
      // anything else is asked, so the two cannot cross.
      const openRead = async (subject: string) => {
        await openFromList(page, ids[subject], `About ${subject}.`);
        await expect.poll(read(subject)).toBe(true);
        await expect.poll(seenInFlight).toBe(0);
      };

      await mailbox.open();
      await expect
        .poll(() => rowIds(page))
        .toEqual(expect.arrayContaining(Object.values(ids)));

      await rowMenu(page, ids.Agenda, /^Mark Read/);
      did('AL-079', 'F-068');
      await expect.poll(read('Agenda')).toBe(true);
      await rowMenu(page, ids.Agenda, /^Mark Unread/);
      did('AL-079', 'F-069');
      await expect.poll(read('Agenda')).toBe(false);

      // Marked unread from its header or its menu, a thread is left for the
      // list, so that opening it again is a choice.
      await openRead('Minutes');
      await header.getByRole('button', { name: 'Mark as unread' }).click();
      did('AL-126', 'F-069');
      await expect.poll(read('Minutes')).toBe(false);
      await expect.poll(() => openThreadId(page)).toBeUndefined();

      await openRead('Budget');
      await titleMenu(page, 'Budget', /^Mark Unread/);
      did('AL-151', 'F-069');
      await expect.poll(read('Budget')).toBe(false);
      await expect.poll(() => openThreadId(page)).toBeUndefined();
    });

    // When this fails, Mark as read on the envelope button of a thread in
    // the reading pane, or Mark Read in the menu after its subject, leaves
    // the message unread at the mailbox, or is not offered once u has marked
    // it unread.
    test('the reading pane marks an unread thread read again', async ({
      page,
      mailbox,
    }) => {
      const ids = await deliverAll(mailbox, ['Minutes', 'Budget']);
      const read = (subject: string) => readAt(mailbox, subject);
      const pane = page.getByRole('region', { name: 'Reading pane' });
      const header = pane.getByRole('group', { name: 'Email actions' });
      const seenInFlight = seenRequestsInFlight(page);
      // u is refused while a read is on its way, and Mark as read while the
      // unread is: each has finished before the next is asked.
      const unreadWithU = async (subject: string) => {
        await expect.poll(read(subject)).toBe(true);
        await expect.poll(seenInFlight).toBe(0);
        await page.getByRole('heading', { name: subject, level: 1 }).click();
        await page.keyboard.press('u');
        const unreadNotice = notice(page, 'Marked as unread');
        await expect(unreadNotice).toBeVisible();
        await unreadNotice.getByRole('button', { name: 'Close' }).click();
        await expect(unreadNotice).toHaveCount(0);
        await expect.poll(read(subject)).toBe(false);
        await expect(
          header.getByRole('button', { name: 'Mark as read' })
        ).toBeVisible();
      };

      await page.setViewportSize({ width: 1600, height: 900 });
      await mailbox.open();
      await expect
        .poll(() => rowIds(page))
        .toEqual(expect.arrayContaining(Object.values(ids)));
      await page.getByRole('button', { name: 'Show reading pane' }).click();

      await openFromList(page, ids.Minutes, 'About Minutes.', pane);
      await unreadWithU('Minutes');
      await header.getByRole('button', { name: 'Mark as read' }).click();
      did('AL-126', 'F-068');
      await expect.poll(read('Minutes')).toBe(true);
      await expect(
        header.getByRole('button', { name: 'Mark as unread' })
      ).toBeVisible();

      await openFromList(page, ids.Budget, 'About Budget.', pane);
      await unreadWithU('Budget');
      await titleMenu(page, 'Budget', /^Mark Read/);
      did('AL-151', 'F-068');
      await expect.poll(read('Budget')).toBe(true);
    });

    // When this fails, Favorite in the row's menu, in the command menu of a
    // selection or in the menu after an open thread's subject does not put
    // the thread among the user's favorites, or cannot take it out again;
    // or the toolbar's Clear leaves the rows selected.
    test('every way to favorite a thread, and unfavorite it', async ({
      page,
      mailbox,
    }) => {
      const ids = await deliverAll(mailbox, ['Agenda', 'Minutes', 'Budget']);
      const selected = page.getByText('1 selected', { exact: true });

      await mailbox.open();
      await expect
        .poll(() => rowIds(page))
        .toEqual(expect.arrayContaining(Object.values(ids)));
      await rowMenu(page, ids.Agenda, /^Favorite/);
      did('AL-080', 'F-073');
      await expect.poll(() => favorites(mailbox)).toEqual([ids.Agenda]);
      await rowMenu(page, ids.Agenda, /^Unfavorite/);
      did('AL-080', 'F-074');
      await expect.poll(() => favorites(mailbox)).toEqual([]);

      // Favoriting leaves the selection as it was, so the same selection
      // takes the thread out again.
      await selectRows(page, [ids.Minutes]);
      await page.getByRole('button', { name: /^Actions/ }).click();
      await commandAction(page, 'favorite', /^Favorite/);
      did('AL-608', 'F-073');
      await expect.poll(() => favorites(mailbox)).toEqual([ids.Minutes]);
      await expect(selected).toBeVisible();
      await page.getByRole('button', { name: /^Actions/ }).click();
      await commandAction(page, 'favorite', /^Unfavorite/);
      did('AL-608', 'F-074');
      await expect.poll(() => favorites(mailbox)).toEqual([]);

      await toolbarButton(page, CLEAR).click();
      did('AL-407');
      await expect(selected).toHaveCount(0);
      await expect(
        row(page, ids.Minutes).getByRole('checkbox', { name: 'Select item' })
      ).not.toBeChecked();

      await openFromList(page, ids.Budget, 'About Budget.');
      await titleMenu(page, 'Budget', 'Favorite');
      did('AL-613', 'F-073');
      await expect.poll(() => favorites(mailbox)).toEqual([ids.Budget]);
      await titleMenu(page, 'Budget', 'Unfavorite');
      did('AL-613', 'F-074');
      await expect.poll(() => favorites(mailbox)).toEqual([]);
    });
  });
}
