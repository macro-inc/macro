// The ways into a thread's Remind me menu besides the shortcut and the
// header button, and the ways out of it: the row's context menu, the menu
// after the open thread's subject, the menu's Cancel, and its Retry after
// the reminder failed to load. Each for a Gmail and an Outlook inbox.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { rowIds } from './harness/list';
import { followup } from './harness/organise';
import { anInbox, PROVIDERS } from './harness/providers';
import {
  deliverAll,
  openFromList,
  rowMenu,
  titleMenu,
} from './harness/ways-organise';
import {
  expectReminder,
  remindTomorrow,
  remindWhen,
} from './harness/ways-organise-more';
import { did } from './ledger/record';

for (const provider of PROVIDERS) {
  test.describe(`reminders on ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, Remind me in the row's menu or in the menu after an
    // open thread's subject saves no reminder for the thread; Cancel saves
    // one anyway or leaves the menu open; or, once the thread's reminder
    // failed to load, Retry does not load it, so nothing can be saved.
    test('every way to set a reminder on a thread, and to leave the menu', async ({
      page,
      mailbox,
    }) => {
      const ids = await deliverAll(mailbox, [
        'Agenda',
        'Minutes',
        'Lunch',
        'Kept',
      ]);
      const menu = page.getByRole('dialog', { name: 'Remind me' });
      // Lunch's reminder fails to load until the test lets it through.
      let failing = true;
      await page.route(
        new RegExp(`/reminders/email/${ids.Lunch}$`),
        async (route) => {
          if (failing && route.request().method() === 'GET') {
            await route.fulfill({ status: 500 });
          } else {
            await route.fallback();
          }
        }
      );

      await mailbox.open();
      await expect
        .poll(() => rowIds(page))
        .toEqual(expect.arrayContaining(Object.values(ids)));
      await rowMenu(page, ids.Agenda, /^Remind me/);
      did('AL-082');
      await remindTomorrow(page);
      await expectReminder(mailbox, ids.Agenda);

      await rowMenu(page, ids.Kept, /^Remind me/);
      await expect(remindWhen(page)).toBeVisible();
      await menu.getByRole('button', { name: 'Cancel' }).click();
      did('AL-189');
      await expect(menu).toHaveCount(0);

      await rowMenu(page, ids.Lunch, /^Remind me/);
      await expect(
        menu.getByText('Couldn’t load this email reminder.')
      ).toBeVisible();
      failing = false;
      await menu.getByRole('button', { name: 'Retry' }).click();
      did('AL-622');
      await expect(
        menu.getByText('Couldn’t load this email reminder.')
      ).toHaveCount(0);
      await remindTomorrow(page);
      await expectReminder(mailbox, ids.Lunch);

      await openFromList(page, ids.Minutes, 'About Minutes.');
      await titleMenu(page, 'Minutes', /^Remind me/);
      did('AL-161');
      await remindTomorrow(page);
      await expectReminder(mailbox, ids.Minutes);

      // Cancelled, the thread has no reminder.
      expect(await followup(mailbox, ids.Kept)).toBeUndefined();
    });
  });
}
