import { expect, test } from './harness/fixtures';
import {
  archiveRequests,
  deliverLabelled,
  focusedRowId,
  openThreadId,
  rowIds,
  seenRequests,
  seenRequestsInFlight,
  sentOperations,
} from './harness/list';

const from = 'Grace <grace@example.com>';

test.describe('thread state from the keyboard', () => {
  // Class state-duplicate-archive-requests: when this fails, one Done press
  // sent the archive more than once (the thread's own archive beside the
  // list's mark-done), which contradict each other on a thread that is
  // already done and make its row flicker.
  test('Done on an open thread sends one archive request', async ({
    page,
    mailbox,
  }) => {
    await mailbox.deliver({ from, subject: 'Minutes', text: 'Attached.' });
    await mailbox.deliver({ from, subject: 'Invoice', text: 'Due Friday.' });
    const minutes = await mailbox.synced('Minutes');
    const invoice = await mailbox.synced('Invoice');
    const sent = sentOperations(page);

    await mailbox.open();
    await page.locator(`[data-entity-id="${invoice.id}"]`).click();
    await expect(page.getByText('Due Friday.')).toBeVisible();
    await page.keyboard.press('e');

    // Done moves on to the next thread; a second Done there is the later
    // event by which a repeat of the first archive would have been sent.
    await expect(page.getByText('Attached.')).toBeVisible();
    await expect.poll(() => openThreadId(page)).toBe(minutes.id);
    await page.keyboard.press('e');
    await expect
      .poll(async () =>
        (await mailbox.providerMessages()).map((message) => message.inInbox)
      )
      .toEqual([false, false]);

    expect(archiveRequests(sent)).toEqual([
      `${invoice.id}:true`,
      `${minutes.id}:true`,
    ]);
  });

  // Class state-mark-read-skipped-on-cached-open: when this fails, stepping
  // onto an unread thread the app already holds left it unread, in Macro and
  // at the provider: the reader stays mounted beside the list and marked
  // only the thread it first showed.
  test('each thread stepped onto in the reading pane is marked read, a cached one too', async ({
    page,
    mailbox,
  }) => {
    const subjects = ['First', 'Second', 'Third'];
    for (const subject of subjects) {
      await mailbox.deliver({ from, subject, text: `Body of ${subject}.` });
    }
    for (const subject of subjects) await mailbox.synced(subject);
    const unread = async () =>
      (await mailbox.providerMessages())
        .filter((message) => !message.read)
        .map((message) => message.subject)
        .sort();
    const sent = sentOperations(page);
    const markingRead = seenRequestsInFlight(page);

    await page.setViewportSize({ width: 1600, height: 900 });
    await mailbox.open();
    await expect.poll(async () => (await rowIds(page)).length).toBe(3);
    const rows = await rowIds(page);
    await page.getByRole('button', { name: 'Show reading pane' }).click();
    await page.locator(`[data-entity-id="${rows[0]}"]`).click();
    await expect.poll(() => openThreadId(page)).toBe(rows[0]);
    await expect.poll(unread).toEqual(['First', 'Second']);
    await page.keyboard.press('j');
    await expect.poll(() => openThreadId(page)).toBe(rows[1]);
    await expect.poll(unread).toEqual(['First']);
    await page.keyboard.press('j');
    await expect.poll(() => openThreadId(page)).toBe(rows[2]);
    await expect.poll(unread).toEqual([]);
    expect(seenRequests(sent)).toEqual(rows);

    // Back on the middle thread, now held by the app: unread it, step away
    // and return. Arriving on it may mark it read once more, and that request
    // can land after the unread; u is pressed again until the unread holds.
    await page.keyboard.press('k');
    await expect.poll(() => openThreadId(page)).toBe(rows[1]);
    await expect
      .poll(async () => {
        const now = await unread();
        if (now.length === 0 && markingRead() === 0) {
          await page.keyboard.press('u');
        }
        return now;
      })
      .toEqual(['Second']);
    await expect.poll(markingRead).toBe(0);
    expect(await unread()).toEqual(['Second']);
    await page.keyboard.press('k');
    await expect.poll(() => openThreadId(page)).toBe(rows[0]);
    await page.keyboard.press('j');
    await expect.poll(() => openThreadId(page)).toBe(rows[1]);
    await expect.poll(unread).toEqual([]);
    const previews = await mailbox.api(
      '/email/email/threads/previews/cursor/all?limit=100'
    );
    const { items } = (await previews.json()) as {
      items: { isRead: boolean }[];
    };
    expect(items.map((item) => item.isRead)).toEqual([true, true, true]);
  });

  // Class state-mark-done-availability: when this fails, Done does nothing
  // in the Noise tab (the tab is missing from the views Done may run in).
  test('Done works on a row of the Noise tab', async ({ page, mailbox }) => {
    await deliverLabelled(
      mailbox,
      {
        from: 'Deals <deals@example.com>',
        subject: 'Sale',
        text: 'Everything must go.',
      },
      ['INBOX', 'UNREAD', 'CATEGORY_PROMOTIONS']
    );
    await mailbox.deliver({ from, subject: 'Lunch?', text: 'Noon?' });
    await mailbox.synced('Lunch?');
    const sale = await mailbox.synced('Sale');

    await mailbox.open();
    await expect(page.getByText('Lunch?')).toBeVisible();
    await page.getByText('Noise', { exact: true }).click();
    await expect.poll(() => rowIds(page)).toEqual([sale.id]);
    await page.keyboard.press('j');
    await expect.poll(() => focusedRowId(page)).toBe(sale.id);
    await page.keyboard.press('e');

    await expect.poll(() => rowIds(page)).toEqual([]);
    await expect
      .poll(async () =>
        (await mailbox.providerMessages())
          .filter((message) => message.inInbox)
          .map((message) => message.subject)
      )
      .toEqual(['Lunch?']);
  });
});
