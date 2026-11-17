// Two controls of a thread's actions that had no name a person using a
// screen reader could find them by, named by this change: the open thread's
// Copy Share Link beside Share, and the X of the selection toolbar. Both
// tests fail at those controls until the served bundle is rebuilt with the
// names.
//
// Gmail only: neither asks the mailbox anything; the link is the screen's
// and the selection is the list's.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { rowIds } from './harness/list';
import {
  deliverAll,
  openFromList,
  row,
  selectRows,
} from './harness/ways-organise';
import { expectClipboard, literally } from './harness/ways-organise-more';
import { did } from './ledger/record';

test.use({ provider: 'GMAIL' });
test.beforeEach(({ page }) => loadAppSteadily(page));

// When this fails, Copy Share Link beside the open thread's Share leaves
// the clipboard without the thread's address.
test("the header's Copy Share Link copies the thread's address", async ({
  page,
  mailbox,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const ids = await deliverAll(mailbox, ['Agenda']);

  await mailbox.open();
  await openFromList(page, ids.Agenda, 'About Agenda.');
  await page
    .getByRole('group', { name: 'Sharing' })
    .getByRole('button', { name: 'Copy Share Link' })
    .click();
  did('AL-196');
  await expectClipboard(
    page,
    new RegExp(
      `^${literally(mailbox.front.origin)}/app/\\S*${literally(ids.Agenda)}`
    )
  );
});

// When this fails, the X of the selection toolbar leaves the rows selected.
test("the selection toolbar's X clears the selection", async ({
  page,
  mailbox,
}) => {
  const ids = await deliverAll(mailbox, ['Agenda', 'Minutes']);

  await mailbox.open();
  await expect
    .poll(() => rowIds(page))
    .toEqual(expect.arrayContaining(Object.values(ids)));
  await selectRows(page, [ids.Agenda, ids.Minutes]);
  await page.getByRole('button', { name: 'Clear selection' }).click();
  did('AL-056');
  await expect(page.getByText('2 selected', { exact: true })).toHaveCount(0);
  for (const id of Object.values(ids)) {
    await expect(
      row(page, id).getByRole('checkbox', { name: 'Select item' })
    ).not.toBeChecked();
  }
});
