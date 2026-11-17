// The notices the list raises when what a key asked for did not happen: the
// service refused mark done, the move to Trash, or its undo, or saved mark
// done for only some of the threads while an undo of it was waiting.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { focusRow, rowIds } from './harness/list';
import { notice } from './harness/send';
import { holdOperation, refuseOperation } from './harness/states-list';
import {
  deliverThreads,
  held,
  listShows,
  rowCheckbox,
} from './harness/ways-list2';
import { did, saw } from './ledger/record';

const DONE = (body: string) => body.includes('"archived":true');
const NOT_DONE = (body: string) => body.includes('"archived":false');

// Each notice answers Macro's own request, which the service refuses or
// saves in part the same way whichever mailbox the thread is in. Gmail only.
test.describe('the failure notices of the list of a Gmail inbox', () => {
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, e on a row whose mark done the service refuses, # on a
  // row whose move to Trash fails, or z on a mark done whose undo the
  // service refuses says nothing, or the row stays out of the list.
  test('refused mark done, failed move to Trash and refused undo each say so', async ({
    page,
    mailbox,
  }) => {
    const ids = await deliverThreads(mailbox, ['Agenda', 'Minutes']);
    let refusingDone = true;
    let refusingUndo = false;
    let failingTrash = true;
    await refuseOperation(
      page,
      'SetEmailThreadsArchived',
      DONE,
      () => refusingDone
    );
    await refuseOperation(
      page,
      'SetEmailThreadsArchived',
      NOT_DONE,
      () => refusingUndo
    );
    // The service client tries a failed request again: every try fails.
    await page.route(/\/email\/threads\/[^/]+\/state(\?|$)/, (route) => {
      const body = route.request().postData() ?? '';
      if (!failingTrash || !body.includes('"trashed"')) return route.fallback();
      return route.fulfill({ status: 500, body: '{}' });
    });

    await mailbox.open();
    await listShows(page, [ids.Agenda, ids.Minutes]);
    await focusRow(page, ids.Agenda);
    await page.keyboard.press('e');
    did('AL-064', 'F-071');
    await expect(notice(page, 'Failed to mark as done')).toBeVisible();
    saw('STL-040');
    await expect.poll(() => rowIds(page)).toContain(ids.Agenda);

    await focusRow(page, ids.Minutes);
    await page.keyboard.press('Shift+Digit3');
    did('AL-068');
    await expect(notice(page, 'Failed to move to Trash')).toBeVisible();
    saw('STL-046');
    await expect.poll(() => rowIds(page)).toContain(ids.Minutes);
    failingTrash = false;

    refusingDone = false;
    await focusRow(page, ids.Agenda);
    await page.keyboard.press('e');
    did('AL-064', 'F-071');
    await expect(notice(page, 'Marked as done')).toBeVisible();
    await expect
      .poll(async () => (await held(mailbox, 'Agenda'))?.inInbox)
      .toBe(false);
    refusingUndo = true;
    await page.keyboard.press('z');
    did('AL-009');
    await expect(notice(page, 'Failed to undo')).toBeVisible();
    saw('STL-054');
    await expect.poll(() => rowIds(page)).not.toContain(ids.Agenda);
  });

  // When this fails, two threads marked done and undone at once, while
  // the service saved the mark done for only one of them, give no warning
  // that the undo reverses only the one it saved.
  test('mark done saved for one of two threads while its undo waited warns which undo runs', async ({
    page,
    mailbox,
  }) => {
    const ids = await deliverThreads(mailbox, ['Agenda', 'Minutes']);
    // Another person's inbox, to hand one of the threads to mid-request:
    // the service then cannot find it among the user's own.
    const bob = await mailbox.stack.user('bob@example.com');
    const bobInbox = await mailbox.stack.link(bob, 'GMAIL');
    const done = await holdOperation(page, 'SetEmailThreadsArchived', DONE);

    await mailbox.open();
    await listShows(page, [ids.Agenda, ids.Minutes]);
    for (const id of [ids.Agenda, ids.Minutes])
      await (await rowCheckbox(page, id)).click();
    await expect(page.getByText('2 selected')).toBeVisible();
    await page.keyboard.press('e');
    did('AL-064', 'F-071');
    await expect.poll(() => done.count()).toBe(1);
    await page.keyboard.press('z');
    did('AL-009');
    await mailbox.stack.sql(
      `UPDATE email_threads SET link_id = '${bobInbox.linkId}' WHERE id = '${ids.Minutes}' RETURNING id`
    );
    await done.release();
    await expect(
      notice(
        page,
        'Some changes could not be saved. Undo will reverse the accepted changes.'
      )
    ).toBeVisible();
    saw('STL-041');
    await expect.poll(() => rowIds(page)).toContain(ids.Agenda);
  });
});
