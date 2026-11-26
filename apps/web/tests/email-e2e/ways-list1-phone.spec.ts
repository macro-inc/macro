// The phone's filter drawer: opening it, its Inbox section, a filter section,
// "Clear all" and "Close filters". For a Gmail and an Outlook inbox.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { createTag, tagThread } from './harness/organise';
import { anInbox, PROVIDERS } from './harness/providers';
import { expectRows, GRACE, PHONE } from './harness/ways-list1';
import { did } from './ledger/record';

const WORK = 'work@example.com';

for (const provider of PROVIDERS) {
  test.describe(`the filter drawer of ${anInbox(provider)} on a phone`, () => {
    test.use({ ...PHONE, provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, the phone's filter button opens no drawer, a row of
    // its Inbox section or of a filter section does not narrow the list,
    // "Clear all" leaves the list narrowed, or "Close filters" leaves the
    // drawer over the list.
    test('the drawer opens, its Inbox and Tags rows narrow the list, Clear all widens it, Close filters closes it', async ({
      page,
      mailbox,
    }) => {
      await mailbox.stack.link(mailbox.user, provider, WORK);
      await mailbox.stack.deliver(WORK, {
        from: GRACE,
        subject: 'Work',
        text: 'About work.',
      });
      await mailbox.deliver({ from: GRACE, subject: 'Lunch?', text: 'Noon?' });
      await mailbox.deliver({ from: GRACE, subject: 'Tagged', text: 'Now.' });
      const work = (await mailbox.synced('Work')).id;
      const lunch = (await mailbox.synced('Lunch?')).id;
      const tagged = (await mailbox.synced('Tagged')).id;
      await tagThread(mailbox, tagged, await createTag(mailbox, 'Urgent'));
      const drawer = page.getByRole('dialog', { name: 'Email filters' });
      const inboxes = drawer.getByRole('group', { name: 'Inbox' });

      await mailbox.open();
      expect(await page.evaluate(() => window.innerWidth)).toBe(
        PHONE.viewport.width
      );
      await expectRows(page, [work, lunch, tagged]);

      await page.getByRole('button', { name: 'Open email filters' }).tap();
      did('AL-030');
      await expect(
        drawer.getByRole('heading', { name: 'Email filters' })
      ).toBeVisible();

      await inboxes.getByRole('checkbox', { name: WORK }).tap();
      did('AL-043');
      await expectRows(page, [work]);
      await inboxes.getByRole('checkbox', { name: 'All inboxes' }).tap();
      await expectRows(page, [work, lunch, tagged]);

      await drawer.getByRole('button', { name: 'Tags', exact: true }).tap();
      await drawer
        .getByRole('group', { name: 'Tags' })
        .getByRole('checkbox', { name: 'Urgent' })
        .tap();
      did('AL-031');
      await expectRows(page, [tagged]);

      await drawer.getByRole('button', { name: 'Clear all' }).tap();
      did('AL-032');
      await expectRows(page, [work, lunch, tagged]);
      await drawer.getByRole('button', { name: 'Close filters' }).tap();
      await expect(drawer).toHaveCount(0);
      await expectRows(page, [work, lunch, tagged]);
    });
  });
}
