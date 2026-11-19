// The notices an open thread raises when it is marked not done (and that
// undone) or unread and read again, each when the request succeeds and when
// the service refuses it.

import type { Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { rowIds, seenRequestsInFlight } from './harness/list';
import { notice } from './harness/send';
import {
  archivedAtProvider,
  holdOperation,
  refuseOperation,
} from './harness/states-thread';
import { readAt } from './harness/ways-organise-more';
import {
  allRead,
  deliverEach,
  held,
  openFromList,
} from './harness/ways-thread';
import { saw } from './ledger/record';

// The notices answer the app's own GraphQL request, which the service
// accepts or refuses the same way whichever mailbox the thread is in; what
// the provider then holds is the organise tests' concern. Gmail only.
test.describe("the notices of an open thread's header", () => {
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, the header's check on a done thread opened by its
  // address (no list row to act on, so the thread unarchives itself) says
  // nothing when the service refuses it, says nothing (or offers no Undo)
  // when it succeeds, or its Undo fails without saying so.
  test('marking a done thread not done: refused, then done with Undo, then Undo refused', async ({
    page,
    mailbox,
  }) => {
    const id = await archivedAtProvider(mailbox, 'Done');

    // Opened by its address, over an inbox where it has no row, before the
    // app's background catch-up of the mailbox has brought it into the
    // page's cache: with neither, the check unarchives the thread itself.
    // The catch-up is held until the end, as on a slow connection.
    const catchUps = [
      await holdOperation(page, 'SoupMailBackfill'),
      await holdOperation(page, 'SoupBackfill'),
    ];
    const seenInFlight = seenRequestsInFlight(page);
    await mailbox.open(`/app/mail/${id}`);
    await expect(page.getByText('About Done.').first()).toBeVisible();
    // Opening it marks it read; that write is done before the next is asked,
    // which would otherwise wait behind it in the app's queue.
    await allRead(mailbox, id);
    await expect.poll(seenInFlight).toBe(0);
    const actions = page.getByRole('group', { name: 'Email actions' });
    let refusing = true;
    await refuseOperation(page, 'SetEmailThreadArchived', () => refusing);
    const notDone = actions.getByRole('button', { name: 'Mark as not done' });
    await notDone.click();
    await expect(notice(page, 'Failed to mark as not done')).toBeVisible();
    saw('STL-075', 'F-072');
    await expect(notDone).toBeVisible();

    refusing = false;
    await notDone.click();
    const marked = notice(page, 'Marked as not done');
    await expect(marked).toBeVisible();
    // The Undo is this notice's own: the list's mark not done offers none.
    const undo = marked.getByRole('button', { name: 'Undo' });
    await expect(undo).toBeVisible();
    saw('STL-074', 'F-072');
    await expect
      .poll(async () => (await held(mailbox, 'Done'))?.inInbox)
      .toBe(true);

    refusing = true;
    await undo.click();
    await expect(notice(page, 'Failed to undo')).toBeVisible();
    saw('STL-074', 'F-083');
    for (const catchUp of catchUps) await catchUp.release();
  });

  // When this fails, marking a thread open beside the list unread from its
  // header says nothing. The view closes the thread in the same click, which
  // drops the request's own callbacks before they raise the notice, and a
  // refusal goes unreported the same way (handoff
  // inline-thread-unread-notice-lost).
  test('known bug: inline-thread-unread-notice-lost: marking the inline thread unread from its header says so @known-bug', {
    tag: '@known-bug',
  }, async ({ page, mailbox }) => {
    const ids = await deliverEach(mailbox, ['Question', 'Stays']);
    await mailbox.open();
    await openFromList(page, ids.Question, 'About Question.');
    await allRead(mailbox, ids.Question);
    await page
      .getByRole('group', { name: 'Email actions' })
      .getByRole('button', { name: 'Mark as unread' })
      .click();
    await expect(page).toHaveURL(/\/app\/mail$/);
    await expect
      .poll(async () => (await held(mailbox, 'Question'))?.read)
      .toBe(false);
    await expect(notice(page, 'Marked as unread')).toBeVisible();
    saw('STL-076');
  });
});

// The thread in the desktop reading pane, which stays open once marked
// unread (the inline thread closes; a phone hides these success notices).
// Gmail only, as above.
test.describe('the read notices of a thread in the reading pane', () => {
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  /** Opens the reading pane over the inbox of these threads. */
  const readingPane = async (
    page: Page,
    mailbox: Mailbox,
    ids: Record<string, string>
  ) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await mailbox.open();
    await expect
      .poll(() => rowIds(page))
      .toEqual(expect.arrayContaining(Object.values(ids)));
    await page.getByRole('button', { name: 'Show reading pane' }).click();
    return page
      .getByRole('region', { name: 'Reading pane' })
      .getByRole('group', { name: 'Email actions' });
  };

  // When this fails, u in the thread of the reading pane (which keeps its
  // keys to itself and stays open) marks it unread without saying so, or a
  // refused mark unread is not reported. The pane's envelope button closes
  // the thread and loses both (inline-thread-unread-notice-lost, above).
  test('marking unread with u, then marking another thread unread refused', async ({
    page,
    mailbox,
  }) => {
    const ids = await deliverEach(mailbox, ['Minutes', 'Budget']);
    const header = await readingPane(page, mailbox, ids);
    // The thread's own read is done before the unread is asked: u is
    // refused while it is on its way.
    const seenInFlight = seenRequestsInFlight(page);
    const unreadWithU = async (subject: string) => {
      await openFromList(page, ids[subject], `About ${subject}.`);
      await allRead(mailbox, ids[subject]);
      await expect.poll(seenInFlight).toBe(0);
      await page.getByRole('heading', { name: subject, level: 1 }).click();
      await page.keyboard.press('u');
    };

    await unreadWithU('Minutes');
    await expect(notice(page, 'Marked as unread')).toBeVisible();
    saw('STL-076');
    await expect
      .poll(async () => (await held(mailbox, 'Minutes'))?.read)
      .toBe(false);

    await refuseOperation(page, 'MarkEmailThreadUnread');
    await unreadWithU('Budget');
    await expect(notice(page, 'Failed to mark as unread')).toBeVisible();
    saw('STL-076');
    await expect(
      header.getByRole('button', { name: 'Mark as unread' })
    ).toBeVisible();
    expect((await held(mailbox, 'Budget'))?.read).toBe(true);
  });

  // When this fails, the reading pane's envelope does not offer Mark as
  // read once its thread is unread, or marks it read again without saying
  // so, or a refused mark read is not reported.
  test('marking read again says so, and says when it is refused', async ({
    page,
    mailbox,
  }) => {
    const ids = await deliverEach(mailbox, ['Minutes', 'Budget']);
    const header = await readingPane(page, mailbox, ids);
    const seenInFlight = seenRequestsInFlight(page);
    const readAtProvider = readAt(mailbox, 'Minutes');
    let refusing = false;
    await refuseOperation(page, 'MarkEmailThreadSeen', () => refusing);

    await openFromList(page, ids.Minutes, 'About Minutes.');
    await expect.poll(readAtProvider).toBe(true);
    await expect.poll(seenInFlight).toBe(0);
    const unreadWithU = async () => {
      await page.getByRole('heading', { name: 'Minutes', level: 1 }).click();
      await page.keyboard.press('u');
      const unreadNotice = notice(page, 'Marked as unread');
      await expect(unreadNotice).toBeVisible();
      await unreadNotice.getByRole('button', { name: 'Close' }).click();
      await expect(unreadNotice).toHaveCount(0);
      await expect.poll(readAtProvider).toBe(false);
    };
    const read = header.getByRole('button', { name: 'Mark as read' });
    await unreadWithU();
    await expect(read).toBeVisible();
    await read.click();
    await expect(notice(page, 'Marked as read')).toBeVisible();
    saw('STL-077');
    await expect.poll(readAtProvider).toBe(true);
    await expect.poll(seenInFlight).toBe(0);

    refusing = true;
    await unreadWithU();
    await read.click();
    await expect(notice(page, 'Failed to mark as read')).toBeVisible();
    saw('STL-077');
  });
});
