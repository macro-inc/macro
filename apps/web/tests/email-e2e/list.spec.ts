import type { Mailbox } from './harness/fixtures';
import { expect, test } from './harness/fixtures';
import {
  archiveRequests,
  catchUpFinished,
  deliverLabelled,
  focusedRowId,
  liveUpdates,
  openThreadId,
  rowIds,
  sentOperations,
} from './harness/list';
import { confirmed, did, saw } from './ledger/record';

const from = 'Grace <grace@example.com>';

/** How many of the mailbox's messages the provider holds outside the inbox. */
async function archivedAtProvider(mailbox: Mailbox): Promise<number> {
  return (await mailbox.providerMessages()).filter(
    (message) => !message.inInbox
  ).length;
}

test.describe('the mail list around Done and Undo', () => {
  const subjects = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];

  test.beforeEach(async ({ mailbox }) => {
    for (const subject of subjects) {
      await mailbox.deliver({ from, subject, text: `Body of ${subject}.` });
    }
    for (const subject of subjects) await mailbox.synced(subject);
  });

  // Class web-list-unstable-after-done: when this fails, marking a row done
  // moved the cursor somewhere other than the row that took its place (or
  // dropped it), reordered the other rows, Undo put the row elsewhere, or
  // next stopped stepping from the opened row.
  test('Done hands the cursor to the row that takes the place, Undo puts the row back', async ({
    page,
    mailbox,
  }) => {
    await mailbox.open();
    await expect.poll(async () => (await rowIds(page)).length).toBe(6);
    const rows = await rowIds(page);
    const without = rows.filter((id) => id !== rows[2]);

    await expect.poll(() => focusedRowId(page)).toBe(rows[0]);
    saw('STL-403', 'F-038');
    await page.keyboard.press('j');
    did('AL-048');
    await page.keyboard.press('j');
    await expect.poll(() => focusedRowId(page)).toBe(rows[2]);
    saw('STL-403', 'F-038');

    await page.keyboard.press('e');
    did('AL-064', 'F-071');
    await expect.poll(() => rowIds(page)).toEqual(without);
    saw('STL-953');
    await expect.poll(() => focusedRowId(page)).toBe(rows[3]);
    await expect.poll(() => archivedAtProvider(mailbox)).toBe(1);
    confirmed('F-071');

    // Undo puts the row back where it was; the cursor stays where Done left it.
    await page.keyboard.press('z');
    did('AL-009');
    await expect.poll(() => rowIds(page)).toEqual(rows);
    saw('STL-955');
    await expect.poll(() => archivedAtProvider(mailbox)).toBe(0);
    confirmed('F-044');
    await page.keyboard.press('k');
    await expect.poll(() => focusedRowId(page)).toBe(rows[2]);

    await page.keyboard.press('e');
    await expect.poll(() => rowIds(page)).toEqual(without);
    await expect.poll(() => focusedRowId(page)).toBe(rows[3]);
    await expect.poll(() => archivedAtProvider(mailbox)).toBe(1);

    // The cursor's row opens, and next steps on from it.
    await page.keyboard.press('Enter');
    did('AL-050');
    await expect.poll(() => openThreadId(page)).toBe(rows[3]);
    await expect(page.getByText(/^Body of \w+\.$/)).toBeVisible();
    saw('STL-906');
    await page.keyboard.press('j');
    did('AL-124');
    await expect.poll(() => openThreadId(page)).toBe(rows[4]);
  });

  // Class web-list-unstable-after-done: when this fails, Done, Undo and Done
  // again pressed without waiting leave the thread in the inbox although the
  // list has dropped its row: the Undo's unarchive is sent after the second
  // archive, so it wins on the server and the row is back after a reload.
  test('known bug: web-list-unstable-after-done: Done, Undo, Done in quick succession leaves the thread done', {
    tag: '@known-bug',
  }, async ({ page, mailbox }) => {
    const sent = sentOperations(page);
    await mailbox.open();
    await expect.poll(async () => (await rowIds(page)).length).toBe(6);
    const rows = await rowIds(page);
    const without = rows.filter((id) => id !== rows[1]);
    await page.keyboard.press('j');
    did('AL-048');
    await expect.poll(() => focusedRowId(page)).toBe(rows[1]);
    saw('STL-403', 'F-038');

    await page.keyboard.press('e');
    did('AL-064', 'F-071');
    await expect.poll(() => rowIds(page)).toEqual(without);
    saw('STL-953');
    await page.keyboard.press('z');
    did('AL-009');
    await expect.poll(() => rowIds(page)).toEqual(rows);
    saw('STL-955');
    await page.keyboard.press('k');
    await expect.poll(() => focusedRowId(page)).toBe(rows[1]);
    await page.keyboard.press('e');
    await expect.poll(() => rowIds(page)).toEqual(without);

    // All three requests are out; the last word must be the last press.
    await expect.poll(() => archiveRequests(sent).length).toBe(3);
    expect(archiveRequests(sent).at(-1)).toBe(`${rows[1]}:true`);
    await expect.poll(() => archivedAtProvider(mailbox)).toBe(1);
    confirmed('F-071');
  });
});

test.describe('what a row shows and opens', () => {
  // Class web-list-rows-and-views: when this fails, a row shows another
  // subject than its thread's header (the row kept the reply prefix the
  // header drops), clicking a row's sender opened a different email or none,
  // or Favorites lists threads that are not starred.
  test('a row carries its thread subject, its sender opens it, and Favorites lists the starred thread', async ({
    page,
    mailbox,
  }) => {
    await mailbox.deliver({ from, subject: 'Plain', text: 'Nothing special.' });
    await mailbox.deliver({
      from: 'Hugo <hugo@example.com>',
      subject: 'Re: Quarterly numbers',
      text: 'Numbers attached.',
    });
    await mailbox.deliver({
      from,
      subject: 'Offsite',
      text: 'Dates to follow.',
    });
    await mailbox.synced('Plain');
    const numbers = await mailbox.synced('Re: Quarterly numbers');
    const offsite = await mailbox.synced('Offsite');

    await mailbox.open();
    const row = page.locator(`[data-entity-id="${numbers.id}"]`);
    await expect(row).toBeVisible();
    // A wide row reads sender, subject, snippet, time.
    const [sender, subject] = (await row.innerText()).split('\n');
    expect(sender).toBe('Hugo');
    expect(subject).toBe('Quarterly numbers');
    saw('STL-965');

    await row.getByText('Hugo', { exact: true }).click();
    did('AL-050');
    await expect.poll(() => openThreadId(page)).toBe(numbers.id);
    await expect(page.getByText('Numbers attached.')).toBeVisible();
    saw('STL-906');
    await expect(page.getByText(subject, { exact: true })).toBeVisible();
    saw('STL-951');

    await page.goBack();
    await expect.poll(async () => (await rowIds(page)).length).toBe(3);
    const rows = await rowIds(page);
    for (const id of rows) {
      if ((await focusedRowId(page)) === offsite.id) break;
      await page.keyboard.press(id === rows[0] ? 'k' : 'j');
      did('AL-048');
    }
    await expect.poll(() => focusedRowId(page)).toBe(offsite.id);
    saw('STL-403', 'F-038');
    await page.keyboard.press('s');
    did('AL-061', 'F-073');
    await page.getByText('Favorites', { exact: true }).click();
    did('AL-002', 'F-030');
    await expect.poll(() => rowIds(page)).toEqual([offsite.id]);
    saw('STL-972');
    saw('STL-923');
  });
});

test.describe('mail that arrives while the list is open', () => {
  // Class web-new-mail-not-inserted: when this fails, a message delivered
  // while the inbox is open got no row until a reload, the row landed below
  // older mail, or the same thread was listed twice.
  //
  // Runs only with EMAIL_E2E_LIVE_UPDATES=1 and no other stack on the Kafka
  // broker: every stack's services read list events as one consumer group,
  // so beside another stack the event for this mailbox can go to that one's
  // services and never reach this page.
  test('a new message gets one row at the top of the open list, without a reload', async ({
    page,
    mailbox,
  }) => {
    test.skip(
      !process.env.EMAIL_E2E_LIVE_UPDATES,
      'needs the Kafka broker to itself'
    );
    test.setTimeout(120_000);
    await mailbox.deliver({ from, subject: 'Earlier', text: 'Already here.' });
    const earlier = await mailbox.synced('Earlier');
    const sent = sentOperations(page);
    await mailbox.open();
    await expect.poll(() => rowIds(page)).toEqual([earlier.id]);
    await expect
      .poll(() => catchUpFinished(page), { timeout: 60_000 })
      .toBe(true);

    // Promotions stay off this tab, so they show when updates have started
    // to flow without adding rows here.
    const updates = await liveUpdates(page);
    let promotions = 0;
    await expect
      .poll(
        async () => {
          promotions += 1;
          const subject = `Promotion ${promotions}`;
          await deliverLabelled(mailbox, { from, subject, text: 'Sale.' }, [
            'INBOX',
            'UNREAD',
            'CATEGORY_PROMOTIONS',
          ]);
          await mailbox.synced(subject);
          return updates();
        },
        { timeout: 60_000, intervals: [1_000] }
      )
      .toBeGreaterThan(0);
    expect(await rowIds(page)).toEqual([earlier.id]);
    let loads = 0;
    page.on('load', () => {
      loads += 1;
    });
    const listReads = sent.filter(({ name }) => name === 'Soup').length;

    await mailbox.deliver({ from, subject: 'Just in', text: 'Fresh.' });
    const justIn = await mailbox.synced('Just in');
    confirmed('F-017');
    await expect.poll(() => rowIds(page)).toEqual([justIn.id, earlier.id]);

    // A later arrival settles the list again: the first one is still listed once.
    await mailbox.deliver({ from, subject: 'And another', text: 'Fresher.' });
    const another = await mailbox.synced('And another');
    await expect
      .poll(() => rowIds(page))
      .toEqual([another.id, justIn.id, earlier.id]);
    await expect(page.getByText('Just in', { exact: true })).toHaveCount(1);
    expect(loads).toBe(0);
    saw('STL-900');
    // The rows came with the live updates, not from reading the list again.
    expect(sent.filter(({ name }) => name === 'Soup').length).toBe(listReads);
  });
});

test.describe('cached mail without a connection', () => {
  // Class web-cache-offline: when this fails, losing the connection emptied
  // the list or left it loading, or a thread the app already holds (one read
  // before, or one only fetched in the background) showed an error or a
  // loader instead of its messages.
  test('the list and its threads stay readable after the connection drops', async ({
    page,
    mailbox,
  }) => {
    test.setTimeout(120_000);
    for (const subject of ['Alpha', 'Bravo', 'Charlie']) {
      await mailbox.deliver({ from, subject, text: `Body of ${subject}.` });
    }
    for (const subject of ['Alpha', 'Bravo', 'Charlie']) {
      await mailbox.synced(subject);
    }
    await mailbox.open();
    await expect.poll(async () => (await rowIds(page)).length).toBe(3);
    const rows = await rowIds(page);
    // The background catch-up is what stores the threads nobody opened.
    await expect
      .poll(() => catchUpFinished(page), { timeout: 60_000 })
      .toBe(true);
    await page.locator(`[data-entity-id="${rows[0]}"]`).click();
    did('AL-050');
    await expect(page.getByText('Body of Charlie.')).toBeVisible();
    saw('STL-906');
    await page.goBack();
    await expect.poll(() => rowIds(page)).toEqual(rows);

    await page.context().setOffline(true);
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);

    // A thread read before, then one never opened.
    await page.locator(`[data-entity-id="${rows[0]}"]`).click();
    await expect.poll(() => openThreadId(page)).toBe(rows[0]);
    await expect(page.getByText('Body of Charlie.')).toBeVisible();
    await page.goBack();
    await expect.poll(() => rowIds(page)).toEqual(rows);
    await page.locator(`[data-entity-id="${rows[1]}"]`).click();
    await expect.poll(() => openThreadId(page)).toBe(rows[1]);
    await expect(page.getByText('Body of Bravo.')).toBeVisible();
    await page.goBack();
    await expect.poll(() => rowIds(page)).toEqual(rows);
  });
});
