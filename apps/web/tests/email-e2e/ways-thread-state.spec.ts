// The keys of an open thread that change its state, and the sender commands
// of its command menu: star, Trash, Remind me, not done, unread and read,
// Block sender, sender to Noise and to Signal. Each is another way into a
// function the list or a menu also reaches. For a Gmail and an Outlook inbox.

import { graphqlOperation, loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { trashFolder } from './harness/journeys';
import { focusRow, rowIds, watchRowIds } from './harness/list';
import { followup } from './harness/organise';
import { anInbox, PROVIDERS } from './harness/providers';
import { notice } from './harness/send';
import { holdOperation } from './harness/states-thread';
import {
  allRead,
  blocked,
  deliverEach,
  favorites,
  held,
  openFromList,
  runThreadCommand,
  senderFilters,
} from './harness/ways-thread';
import { keyboardInThread } from './harness/ways-thread-more';
import { did, saw } from './ledger/record';

for (const provider of PROVIDERS) {
  test.describe(`the keys of an open thread in ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a key that works on a row of the list does nothing
    // in the open thread: s leaves the thread out of (or in) the favorites,
    // # leaves it out of the provider's trash, Shift+E leaves a done thread
    // out of the provider's inbox, or h opens no Remind me.
    test('s stars and unstars, # moves to Trash, Shift+E marks not done, h sets a reminder', async ({
      page,
      mailbox,
    }) => {
      const ids = await deliverEach(mailbox, [
        'Star',
        'Bin',
        'Later',
        'Done',
        'Stays',
      ]);
      await mailbox.open();

      // s, and s again.
      await openFromList(page, ids.Star, 'About Star.');
      await page.keyboard.press('s');
      did('AL-144', 'F-073');
      await expect.poll(() => favorites(mailbox)).toEqual([ids.Star]);
      await expect(notice(page, 'Added to favorites')).toBeVisible();
      await page.keyboard.press('s');
      did('AL-144', 'F-074');
      await expect.poll(() => favorites(mailbox)).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(page).toHaveURL(/\/app\/mail$/);

      // '#' as a keyboard types it: Shift with the 3 key.
      await openFromList(page, ids.Bin, 'About Bin.');
      await page.keyboard.press('Shift+Digit3');
      did('AL-145');
      await expect
        .poll(async () => (await held(mailbox, 'Bin'))?.labels)
        .toContain(trashFolder(provider));
      // The thread is gone, so the list is back, without its row.
      await expect(page).toHaveURL(/\/app\/mail$/);
      await expect
        .poll(async () =>
          (await rowIds(page)).filter(
            (id) => id === ids.Bin || id === ids.Stays
          )
        )
        .toEqual([ids.Stays]);
      saw('STL-990');

      // A thread marked done in its header, opened again from Archived.
      await openFromList(page, ids.Done, 'About Done.');
      await page
        .getByRole('group', { name: 'Email actions' })
        .getByRole('button', { name: 'Mark done' })
        .click();
      await expect
        .poll(async () => (await held(mailbox, 'Done'))?.inInbox)
        .toBe(false);
      await page
        .getByRole('navigation', { name: 'Email library' })
        .getByRole('button', { name: 'Archived' })
        .click();
      await expect(page).toHaveURL(/tab=archived/);
      await openFromList(page, ids.Done, 'About Done.');
      await page.keyboard.press('Shift+E');
      did('AL-138');
      await expect
        .poll(async () => (await held(mailbox, 'Done'))?.inInbox)
        .toBe(true);
      await mailbox.open();

      // h opens Remind me for the thread.
      await openFromList(page, ids.Later, 'About Later.');
      await page.keyboard.press('h');
      did('AL-146');
      const when = page.getByRole('combobox', { name: 'Remind me when' });
      await expect(when).toBeVisible();
      await when.fill('tomorrow 9am');
      await expect(
        page.getByRole('option', { name: /^tomorrow 9am/ })
      ).toBeVisible();
      await when.press('Enter');
      await expect
        .poll(() => followup(mailbox, ids.Later))
        .toMatchObject({ state: 'pending', condition: 'if_no_reply' });
    });

    // When this fails, a thread trashed while its mark read is still on its
    // way stays in the list, read and with no time: the list's refresh after
    // the Trash leaves it out, and the cache keeps it for the mark read.
    test('# right after opening a thread takes it out of the list before its mark read lands', async ({
      page,
      mailbox,
    }) => {
      const ids = await deliverEach(mailbox, ['Bin', 'Stays']);
      await mailbox.open();
      const marks = await holdOperation(page, 'MarkEmailThreadSeen', (body) =>
        body.includes(ids.Bin)
      );

      await openFromList(page, ids.Bin, 'About Bin.');
      await expect.poll(marks.held).toBeGreaterThan(0);
      await page.keyboard.press('Shift+Digit3');
      did('AL-145');
      await expect
        .poll(async () => (await held(mailbox, 'Bin'))?.labels)
        .toContain(trashFolder(provider));
      await expect(page).toHaveURL(/\/app\/mail$/);
      await expect.poll(() => rowIds(page)).toEqual([ids.Stays]);
      saw('STL-990');

      // The mark read landing late does not bring it back. The star of the
      // other row waits in the queue behind the mark reads: once it reaches
      // the service, the cache has settled them.
      const shown = await watchRowIds(page);
      await marks.release();
      await allRead(mailbox, ids.Bin);
      await focusRow(page, ids.Stays);
      await page.keyboard.press('s');
      did('AL-061', 'F-073');
      await expect.poll(() => favorites(mailbox)).toEqual([ids.Stays]);
      expect((await shown()).filter((rows) => rows.includes(ids.Bin))).toEqual(
        []
      );
      expect(await rowIds(page)).toEqual([ids.Stays]);
    });

    // The open thread keeps its Mark as read toggle when its own unread
    // write reaches the mailbox, so Shift+U can mark it read again.
    test('u marks the open thread unread, Shift+U read again', async ({
      page,
      mailbox,
    }) => {
      const ids = await deliverEach(mailbox, ['Question', 'Stays']);
      await mailbox.open();
      await openFromList(page, ids.Question, 'About Question.');
      // Opening it marks it read; that is done before the unread is asked.
      await expect
        .poll(async () => (await held(mailbox, 'Question'))?.read)
        .toBe(true);
      await allRead(mailbox, ids.Question);
      // The keyboard in the thread: a click on its subject.
      await keyboardInThread(page, 'Question');
      const toggle = page
        .getByRole('group', { name: 'Email actions' })
        .getByRole('button', { name: /^Mark as (un)?read$/ });

      await page.keyboard.press('u');
      did('AL-139');
      await expect
        .poll(async () => (await held(mailbox, 'Question'))?.read)
        .toBe(false);
      await expect(notice(page, 'Marked as unread')).toBeVisible();
      await expect(toggle).toHaveAccessibleName('Mark as read');
      await page.keyboard.press('Shift+U');
      did('AL-140');
      await expect(notice(page, 'Marked as read')).toBeVisible();
      await expect
        .poll(async () => (await held(mailbox, 'Question'))?.read)
        .toBe(true);
    });

    // When this fails, the command menu of an open thread does not offer
    // the sender commands, or picking one saves no block or no filter for
    // the sender of the thread.
    test('Cmd+K in the open thread blocks its sender, and moves a sender to Noise and to Signal', async ({
      page,
      mailbox,
    }) => {
      const senders: Record<string, string> = {
        Photos: 'Hal <hal@example.com>',
        Offers: 'Ida <ida@example.com>',
      };
      const ids = await deliverEach(
        mailbox,
        ['Photos', 'Offers'],
        (subject) => senders[subject]
      );
      await mailbox.open();

      await openFromList(page, ids.Photos, 'About Photos.');
      await runThreadCommand(page, 'Block sender');
      did('AL-147', 'F-080');
      await expect.poll(() => blocked(mailbox)).toEqual(['hal@example.com']);
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await expect(page).toHaveURL(/\/app\/mail$/);

      await openFromList(page, ids.Offers, 'About Offers.');
      await runThreadCommand(page, 'Mark sender as Noise');
      did('AL-147', 'F-081');
      await expect
        .poll(() => senderFilters(mailbox))
        .toContainEqual({ address: 'ida@example.com', signal: false });
      await expect(notice(page, 'Sender marked as Noise')).toBeVisible();
      // The thread has left the Signal list under it: the keyboard goes
      // back to the thread first.
      await keyboardInThread(page, 'Offers');
      await runThreadCommand(page, 'Mark sender as Signal');
      did('AL-147', 'F-081');
      await expect
        .poll(() => senderFilters(mailbox))
        .toContainEqual({ address: 'ida@example.com', signal: true });
    });
  });
}

test.describe('a reload just after a thread was opened, in an Outlook inbox', () => {
  test.use({ provider: 'OUTLOOK' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, the reload cut off the mark read of the thread just
  // opened, and its claim on the mutation queue outlived the page: Mark done
  // takes the row out of Macro's list, but waits behind that claim, so the
  // provider keeps the thread in the inbox. Without the release of a departed
  // page's claim it still passes in about a third of runs, where the new
  // page finds the head free at once: the page that reloaded put its claim
  // back before it went.
  test('Mark done after a reload reaches the provider', async ({
    page,
    mailbox,
  }) => {
    const ids = await deliverEach(mailbox, ['Later', 'Done', 'Stays']);
    // The first mark read reaches the service, and its answer is held until
    // the page that sent it has been reloaded away, as a slow one is.
    let reloaded = () => {};
    const reload = new Promise<void>((resolve) => {
      reloaded = resolve;
    });
    let cutOff = 0;
    await page.route(/\/graphql$/, async (route) => {
      if (
        cutOff > 0 ||
        graphqlOperation(route.request()) !== 'MarkEmailThreadSeen'
      )
        return route.fallback();
      cutOff += 1;
      await route.fetch();
      await reload;
      try {
        await route.abort();
      } catch {
        // The reload already cancelled the request.
      }
    });
    await mailbox.open();
    await openFromList(page, ids.Later, 'About Later.');
    await page.keyboard.press('h');
    const when = page.getByRole('combobox', { name: 'Remind me when' });
    await when.fill('tomorrow 9am');
    await expect(
      page.getByRole('option', { name: /^tomorrow 9am/ })
    ).toBeVisible();
    await when.press('Enter');
    await expect
      .poll(() => followup(mailbox, ids.Later))
      .toMatchObject({ state: 'pending' });
    await expect.poll(() => cutOff).toBe(1);
    await mailbox.open();
    reloaded();

    await openFromList(page, ids.Done, 'About Done.');
    await page
      .getByRole('group', { name: 'Email actions' })
      .getByRole('button', { name: 'Mark done' })
      .click();
    did('AL-127', 'F-071');
    await expect
      .poll(async () => (await held(mailbox, 'Done'))?.inInbox)
      .toBe(false);
    saw('STL-991');
  });
});
