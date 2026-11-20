// The ways into a thread's Remind me menu besides the shortcut and the
// header button, and the ways out of it: the row's context menu, the menu
// after the open thread's subject, the menu's Cancel, and its Retry after
// the reminder failed to load. Each for a Gmail and an Outlook inbox.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { rowIds } from './harness/list';
import { followup } from './harness/organise';
import { anInbox, PROVIDERS } from './harness/providers';
import { deliverAll, rowMenu, titleMenu } from './harness/ways-organise';
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

    // When this fails, Remind me in a row's menu opens no reminder menu, one
    // that closes at once (the row menu's own dismissal reaching it), or
    // one whose time saves no reminder for the thread.
    test("Remind me in a row's menu sets a reminder on the thread", async ({
      page,
      mailbox,
    }) => {
      const ids = await deliverAll(mailbox, ['Agenda']);
      await mailbox.open();
      await expect.poll(() => rowIds(page)).toEqual([ids.Agenda]);
      await rowMenu(page, ids.Agenda, /^Remind me/);
      did('AL-082');
      await remindTomorrow(page);
      await expectReminder(mailbox, ids.Agenda);
    });

    // When this fails, Remind me in the menu after an open thread's subject
    // saves no reminder for the thread; Cancel saves one anyway or leaves
    // the menu open; or, once the thread's reminder failed to load, Retry
    // does not load it, so nothing can be saved.
    test('setting a reminder on an open thread, and leaving the menu', async ({
      page,
      mailbox,
    }) => {
      const ids = await deliverAll(mailbox, ['Minutes', 'Lunch', 'Kept']);
      const menu = page.getByRole('dialog', { name: 'Remind me' });
      // By its address: a thread whose reminder is set gives the screen to
      // the next one, and the list is then a guess away.
      const opened = async (id: string, subject: string) => {
        await mailbox.open(`/app/email/${id}`);
        await expect(page.getByText(`About ${subject}.`).first()).toBeVisible();
      };
      // Lunch's reminder fails to load until the test lets it through.
      let failing = true;
      let lastRead = 0;
      await page.route(
        new RegExp(`/reminders/email/${ids.Lunch}$`),
        async (route) => {
          if (route.request().method() === 'GET') lastRead = Date.now();
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
      await opened(ids.Kept, 'Kept');
      await titleMenu(page, 'Kept', /^Remind me/);
      did('AL-161');
      await expect(remindWhen(page)).toBeVisible();
      await menu.getByRole('button', { name: 'Cancel' }).click();
      did('AL-189');
      await expect(menu).toHaveCount(0);

      await opened(ids.Lunch, 'Lunch');
      await titleMenu(page, 'Lunch', /^Remind me/);
      await expect(
        menu.getByText('Couldn’t load this email reminder.')
      ).toBeVisible();
      // The menu reads a reminder that failed to load again by itself: once
      // more a second later, then every five seconds. In the quiet after
      // such a pair, only Retry can load it within two seconds.
      await expect
        .poll(() => Date.now() - lastRead, { intervals: [100] })
        .toBeGreaterThan(1_500);
      failing = false;
      await menu.getByRole('button', { name: 'Retry' }).click();
      did('AL-622');
      await expect(
        menu.getByText('Couldn’t load this email reminder.')
      ).toHaveCount(0, { timeout: 2_000 });
      await remindTomorrow(page);
      await expectReminder(mailbox, ids.Lunch);

      await opened(ids.Minutes, 'Minutes');
      await titleMenu(page, 'Minutes', /^Remind me/);
      await remindTomorrow(page);
      await expectReminder(mailbox, ids.Minutes);

      // Cancelled, the thread has no reminder.
      expect(await followup(mailbox, ids.Kept)).toBeUndefined();
    });
  });
}
