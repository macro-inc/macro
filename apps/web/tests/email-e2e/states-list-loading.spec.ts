// What the list shows while it loads: "Loading email" in place of the list
// while a saved view's settings load, and inside the list while its own
// request is on its way.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { rowIds } from './harness/list';
import { emptyTitle, holdOperation, sidebarTab } from './harness/states-list';
import { GRACE } from './harness/ways-list1';
import { storeView } from './harness/ways-saved-views';
import { saw } from './ledger/record';

// Gmail only: both spinners wait on Macro's own requests, whatever the
// mailbox.
test.describe('the list of a Gmail inbox loading', () => {
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, the list shows no spinner while a saved view's
  // settings load (or the view's rows never come once they have), or a tab
  // whose request is still on its way shows no spinner in the list.
  test('a saved view loading, then a tab loading, each show Loading email', async ({
    page,
    mailbox,
  }) => {
    await mailbox.deliver({ from: GRACE, subject: 'Alpha', text: 'Hello.' });
    const alpha = (await mailbox.synced('Alpha')).id;
    const view = await storeView(mailbox, 'Alpha mail', {
      subject: ['Alpha'],
    });
    const settings = await holdOperation(page, 'SavedView');
    const settingsList = await holdOperation(page, 'SavedViews');
    const list = page.getByRole('grid', { name: 'Email' });
    const spinner = page.getByLabel('Loading email');

    await mailbox.open(`/app/mail?s0.mail.savedView=${view}&s0.mail.tab=all`);
    await expect
      .poll(() => settings.count() + settingsList.count())
      .toBeGreaterThan(0);
    await expect(spinner).toBeVisible();
    await expect(list).toHaveCount(0);
    saw('STL-001');
    await settings.release();
    await settingsList.release();
    await expect.poll(() => rowIds(page)).toEqual([alpha]);
    await expect(spinner).toHaveCount(0);

    // Archived has never been asked for: until its request answers there
    // is nothing to show. Every list request waits from here on.
    const archived = await holdOperation(page, 'Soup');
    await sidebarTab(page, 'Archived');
    await expect.poll(() => archived.count()).toBeGreaterThan(0);
    await expect(list.getByLabel('Loading email')).toBeVisible();
    saw('STL-002');
    await archived.release();
    await expect(emptyTitle(page, 'No archived email')).toBeVisible();
    await expect(spinner).toHaveCount(0);
  });
});
