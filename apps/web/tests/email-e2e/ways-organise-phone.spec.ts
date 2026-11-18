// The phone's way into a row's actions: a long press opens them in a
// drawer instead of the desktop's context menu.
//
// Gmail only: the drawer is the screen's, and what its actions do at each
// mailbox is covered from the desktop's menu for both.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { rowIds } from './harness/list';
import { PHONE } from './harness/ways-list1';
import { deliverAll, longPress, row } from './harness/ways-organise';
import { inInboxAt } from './harness/ways-organise-more';
import { did } from './ledger/record';

test.use({ ...PHONE, provider: 'GMAIL' });
test.beforeEach(({ page }) => loadAppSteadily(page));

// When this fails, holding a finger on a row opens no drawer of the row's
// actions, one for another row, or one whose actions do nothing.
test("a long press opens the row's actions, and they act on that row", async ({
  page,
  mailbox,
}) => {
  const ids = await deliverAll(mailbox, ['Agenda', 'Minutes']);
  const drawer = page.getByRole('dialog', { name: 'Entity actions' });

  await mailbox.open();
  await expect
    .poll(() => rowIds(page))
    .toEqual(expect.arrayContaining(Object.values(ids)));
  await longPress(page, ids.Agenda, drawer);
  did('AL-605');
  await expect(drawer.getByText('Agenda', { exact: true })).toBeVisible();
  await expect(drawer.getByText('Minutes', { exact: true })).toHaveCount(0);
  await drawer.getByRole('button', { name: 'Mark Done' }).tap();
  await expect(drawer).toHaveCount(0);
  await expect.poll(inInboxAt(mailbox, 'Agenda')).toBe(false);
  await expect(row(page, ids.Agenda)).toHaveCount(0);
  expect(await inInboxAt(mailbox, 'Minutes')()).toBe(true);
});
