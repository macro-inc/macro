// What the list shows on a phone alone: the Calendar tab's empty state, and
// the filter drawer with its trigger, its sheet, its section label (Filters,
// or Inboxes on Scheduled) and the count of active filters on the trigger.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { createTag, tagThread } from './harness/organise';
import { emptyTitle } from './harness/states-list';
import {
  expectRows,
  GRACE,
  openTouchTab,
  PHONE,
  touchHeaderName,
} from './harness/ways-list1';
import { did, saw } from './ledger/record';

// Gmail only: the tabs and the drawer are drawn by the same code whatever
// the mailbox, and the tag filtered on is Macro's own.
test.describe('the phone list of a Gmail inbox', () => {
  test.use({ ...PHONE, provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, an empty Calendar tab shows no title of its own, the
  // filter drawer's trigger or sheet lost its name, the sheet's section
  // label does not say Filters (or Inboxes on Scheduled), or the trigger
  // shows no count while a filter is set, or keeps it once cleared.
  test('Calendar says it is empty, and the drawer names its section and counts the filters set', async ({
    page,
    mailbox,
  }) => {
    await mailbox.deliver({ from: GRACE, subject: 'Tagged', text: 'Now.' });
    const tagged = (await mailbox.synced('Tagged')).id;
    await tagThread(mailbox, tagged, await createTag(mailbox, 'Urgent'));
    const trigger = page.getByRole('button', { name: 'Open email filters' });
    const drawer = page.getByRole('dialog', { name: 'Email filters' });

    await mailbox.open();
    expect(await page.evaluate(() => window.innerWidth)).toBe(
      PHONE.viewport.width
    );
    await expectRows(page, [tagged]);

    await openTouchTab(page, 'Calendar');
    await expect(touchHeaderName(page, 'Calendar')).toBeVisible();
    await expect(emptyTitle(page, 'No calendar email')).toBeVisible();
    saw('STL-015');

    await openTouchTab(page, 'Signal');
    await expectRows(page, [tagged]);
    await expect(trigger).toHaveText('');
    await trigger.tap();
    did('AL-030');
    await expect(
      drawer.getByRole('heading', { name: 'Email filters' })
    ).toBeVisible();
    await expect(drawer.getByText('Filters', { exact: true })).toBeVisible();
    saw('STL-110');

    await drawer.getByRole('button', { name: 'Tags', exact: true }).tap();
    await drawer
      .getByRole('group', { name: 'Tags' })
      .getByRole('checkbox', { name: 'Urgent' })
      .tap();
    did('AL-031');
    await drawer.getByRole('button', { name: 'Close filters' }).tap();
    await expect(drawer).toHaveCount(0);
    await expect(trigger).toHaveText('1');
    saw('STL-405');

    await trigger.tap();
    await drawer.getByRole('button', { name: 'Clear all' }).tap();
    did('AL-032');
    await drawer.getByRole('button', { name: 'Close filters' }).tap();
    await expect(drawer).toHaveCount(0);
    await expect(trigger).toHaveText('');

    await openTouchTab(page, 'Scheduled');
    await expect(touchHeaderName(page, 'Scheduled')).toBeVisible();
    await trigger.tap();
    await expect(drawer.getByText('Inboxes', { exact: true })).toBeVisible();
    await expect(drawer.getByText('Filters', { exact: true })).toHaveCount(0);
    saw('STL-110');
  });
});
