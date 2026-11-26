// What the header of a thread open on a desktop shows: the read and done
// toggles' labels, the thread closing when it is marked unread, Previous
// and Next item at the ends of the list, and the notices of Copy Share Link.
//
// The labels and buttons follow the thread's state in the app, the same
// whichever mailbox the thread is in; what each mailbox then holds is the
// organise tests' concern. Gmail only.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { openThreadId, rowIds, seenRequestsInFlight } from './harness/list';
import { notice } from './harness/send';
import { threadActions } from './harness/states-organise';
import { deliverAll, openFromList, row } from './harness/ways-organise';
import {
  expectClipboard,
  inInboxAt,
  readAt,
} from './harness/ways-organise-more';
import { saw } from './ledger/record';

test.describe('the header of a thread open on a desktop', () => {
  test.use({ provider: 'GMAIL' });
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await loadAppSteadily(page);
  });

  // When this fails, Previous item stays pressable on the first thread of
  // the list or Next item on the last (or one is disabled where there is a
  // thread to go to), or Copy Share Link says nothing when it copies, or
  // says nothing when the clipboard refuses the link.
  test('Previous and Next item stop at the ends of the list; Copy Share Link says whether it copied', async ({
    page,
    mailbox,
  }) => {
    const ids = await deliverAll(mailbox, ['Agenda', 'Minutes', 'Budget']);
    const subjectOf = Object.fromEntries(
      Object.entries(ids).map(([subject, id]) => [id, subject])
    );
    await mailbox.open();
    await expect
      .poll(() => rowIds(page))
      .toEqual(expect.arrayContaining(Object.values(ids)));
    const order = (await rowIds(page)).filter((id) => id in subjectOf);
    const [first, middle, last] = order;
    const navigation = page.getByRole('group', { name: 'Item navigation' });
    const previous = navigation.getByRole('button', { name: 'Previous item' });
    const next = navigation.getByRole('button', { name: 'Next item' });

    await openFromList(page, first, `About ${subjectOf[first]}.`);
    await expect(previous).toBeDisabled();
    await expect(next).toBeEnabled();
    saw('STL-614');
    await next.click();
    await expect.poll(() => openThreadId(page)).toBe(middle);
    await expect(next).toBeEnabled();
    await next.click();
    await expect.poll(() => openThreadId(page)).toBe(last);
    await expect(page.getByText(`About ${subjectOf[last]}.`)).toBeVisible();
    await expect(next).toBeDisabled();
    await expect(previous).toBeEnabled();
    saw('STL-614');

    const copyLink = page
      .getByRole('group', { name: 'Sharing' })
      .getByRole('button', { name: 'Copy Share Link' });
    await copyLink.click();
    await expect(notice(page, 'Link copied to clipboard.')).toBeVisible();
    saw('STL-615');
    await expectClipboard(page, new RegExp(last));

    // A clipboard that refuses the write.
    await page.evaluate(() => {
      navigator.clipboard.writeText = () =>
        Promise.reject(new Error('refused'));
    });
    await copyLink.click();
    await expect(notice(page, 'Could not copy link')).toBeVisible();
    saw('STL-615');
  });

  // When this fails, the envelope of a read thread does not offer Mark as
  // unread, the check of a thread in the inbox does not offer Mark done or
  // that of a done thread Mark as not done, or marking the thread open in
  // the list's place unread leaves it open instead of going back to the
  // list.
  test('the read and done toggles name what they will do; marking unread goes back to the list', async ({
    page,
    mailbox,
  }) => {
    const ids = await deliverAll(mailbox, ['Agenda', 'Minutes']);
    const actions = threadActions(page);
    const seenInFlight = seenRequestsInFlight(page);
    await mailbox.open();
    await expect
      .poll(() => rowIds(page))
      .toEqual(expect.arrayContaining(Object.values(ids)));

    await openFromList(page, ids.Agenda, 'About Agenda.');
    // Opening it marks it read; an unread is refused while that is on its
    // way.
    await expect.poll(readAt(mailbox, 'Agenda')).toBe(true);
    await expect.poll(seenInFlight).toBe(0);
    const unread = actions.getByRole('button', {
      name: 'Mark as unread',
      exact: true,
    });
    await expect(unread).toBeVisible();
    saw('STL-072', 'F-069');
    await expect(
      actions.getByRole('button', { name: 'Mark done', exact: true })
    ).toBeVisible();
    saw('STL-073', 'F-071');

    await unread.click();
    await expect.poll(() => openThreadId(page)).toBeUndefined();
    await expect(page).toHaveURL(/\/app\/mail(\?|$)/);
    await expect(row(page, ids.Agenda)).toBeVisible();
    saw('STL-611', 'F-069');
    await expect.poll(readAt(mailbox, 'Agenda')).toBe(false);

    await openFromList(page, ids.Minutes, 'About Minutes.');
    await actions
      .getByRole('button', { name: 'Mark done', exact: true })
      .click();
    await expect.poll(inInboxAt(mailbox, 'Minutes')).toBe(false);
    // Opened again by its address, over an inbox it is no longer in.
    await mailbox.open(`/app/mail/${ids.Minutes}`);
    await expect(page.getByText('About Minutes.').first()).toBeVisible();
    await expect(
      actions.getByRole('button', { name: 'Mark as not done', exact: true })
    ).toBeVisible();
    saw('STL-073', 'F-072');
  });

  // When this fails, the envelope of the reading pane's thread does not
  // offer Mark as read once the thread is unread. Use u because clicking
  // the envelope to mark it unread closes the thread.
  test('the envelope offers Mark as read once the thread is unread', async ({
    page,
    mailbox,
  }) => {
    const ids = await deliverAll(mailbox, ['Minutes', 'Budget']);
    const pane = page.getByRole('region', { name: 'Reading pane' });
    const header = pane.getByRole('group', { name: 'Email actions' });
    const toggle = header.getByRole('button', { name: /^Mark as (un)?read$/ });
    const seenInFlight = seenRequestsInFlight(page);

    await page.setViewportSize({ width: 1600, height: 900 });
    await mailbox.open();
    await expect
      .poll(() => rowIds(page))
      .toEqual(expect.arrayContaining(Object.values(ids)));
    await page.getByRole('button', { name: 'Show reading pane' }).click();
    await openFromList(page, ids.Minutes, 'About Minutes.', pane);
    await expect.poll(readAt(mailbox, 'Minutes')).toBe(true);
    await expect.poll(seenInFlight).toBe(0);
    await expect(toggle).toHaveAccessibleName('Mark as unread');
    await page.getByRole('heading', { name: 'Minutes', level: 1 }).click();
    await page.keyboard.press('u');
    await expect.poll(readAt(mailbox, 'Minutes')).toBe(false);
    await expect(toggle).toHaveAccessibleName('Mark as read');
    saw('STL-072', 'F-068');

    await openFromList(page, ids.Budget, 'About Budget.', pane);
    await expect.poll(readAt(mailbox, 'Budget')).toBe(true);
    await expect(toggle).toHaveAccessibleName('Mark as unread');
  });
});
