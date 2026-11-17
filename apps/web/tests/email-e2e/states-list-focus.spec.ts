// What a Focus row says about its thread: the one reason it is in Focus
// (what the owner owes, else what the mail is), the day the mail says it is
// due, and its importance meter with the way importance is moving.

import { loadAppSteadily } from './harness/drafts';
import { expect, test } from './harness/fixtures';
import { inboxTab, isoDay, localDay, seedFocus } from './harness/states-list';
import { threadMessages } from './harness/thread';
import { replyAtGmail } from './harness/ways-list-more';
import { expectRows, GRACE, HUGO, row } from './harness/ways-list1';
import { saw } from './ledger/record';

/** How a row names a due day this far ahead, as `focus-due.ts` words it. */
function dueLabel(days: number): string {
  const day = localDay(days);
  if (days < 0) return 'Overdue';
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days < 7)
    return `Due ${day.toLocaleDateString('en-US', { weekday: 'short' })}`;
  const sameYear = day.getFullYear() === new Date().getFullYear();
  return `Due ${day.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })}`;
}

// Gmail only: Focus shows what its worker stored for each thread, whatever
// the provider, and the owner's own reply that makes a Follow up is put in
// the mailbox through the Gmail emulator.
test.describe('the Focus rows of a Gmail inbox', () => {
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  // When this fails, a Focus row shows the wrong reason (or none) for what
  // the owner owes or what the mail is, the wrong due day (or none), or its
  // importance meter does not say that importance is rising or falling.
  test('each row names its reason and due day, and the meter says which way importance moves', async ({
    page,
    mailbox,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    const subjects = ['Question', 'Promise', 'Reschedule', 'Order', 'Standup'];
    for (const subject of subjects)
      await mailbox.deliver({
        from: subject === 'Promise' ? HUGO : GRACE,
        subject,
        text: `About ${subject}.`,
        ...(subject === 'Promise'
          ? { messageId: 'promise-1@example.com' }
          : {}),
      });
    await mailbox.deliver({ from: GRACE, subject: 'Hello', text: 'Hi.' });
    const ids: Record<string, string> = {};
    for (const subject of [...subjects, 'Hello'])
      ids[subject] = (await mailbox.synced(subject)).id;
    // Follow up is a thread the owner wrote last in.
    await replyAtGmail(mailbox, {
      inReplyTo: 'promise-1@example.com',
      to: 'hugo@example.com',
      subject: 'Re: Promise',
      text: 'I will, on Monday.',
    });
    await expect
      .poll(async () =>
        (await threadMessages(mailbox, ids.Promise)).map((m) => m.is_sent)
      )
      .toEqual([false, true]);
    // Each row: its reason, its due day this many days ahead, its trend.
    const rows = [
      { subject: 'Question', reason: 'Reply needed', days: 0, rate: 10 },
      { subject: 'Promise', reason: 'Follow up', days: 1, rate: -10 },
      { subject: 'Reschedule', reason: 'Calendar change', days: 3 },
      { subject: 'Order', reason: 'Customer', days: 10 },
      { subject: 'Standup', reason: 'Teammate', days: 400 },
      { subject: 'Hello', reason: 'Contact', days: -3 },
    ] as const;
    const seeds = {
      Question: { flag: 'reply' },
      Promise: { flag: 'follow-up' },
      Reschedule: { category: 'calendar' },
      Order: { category: 'customer' },
      Standup: { category: 'team' },
      Hello: { category: 'known' },
    } as const;
    for (const { subject, days, ...rest } of rows)
      await seedFocus(mailbox, ids[subject], {
        ...seeds[subject],
        dueOn: isoDay(localDay(days)),
        rate: 'rate' in rest ? rest.rate : 0,
      });

    await mailbox.open();
    await inboxTab(page, 'Focus');
    await expectRows(
      page,
      rows.map(({ subject }) => ids[subject])
    );
    for (const { subject, reason } of rows) {
      await expect(
        row(page, ids[subject]).getByText(reason, { exact: true })
      ).toBeVisible();
      saw('STL-033');
    }
    for (const { subject, days } of rows) {
      await expect(
        row(page, ids[subject]).getByText(dueLabel(days), { exact: true })
      ).toBeVisible();
      saw('STL-034');
    }

    const meter = (subject: string) =>
      row(page, ids[subject]).getByRole('img', { name: /^Importance \d+ of/ });
    await expect(meter('Question')).toHaveAccessibleName(
      /^Importance \d+ of 100, rising$/
    );
    await expect(meter('Promise')).toHaveAccessibleName(
      /^Importance \d+ of 100, falling$/
    );
    await expect(meter('Order')).toHaveAccessibleName(/^Importance 50 of 100$/);
    saw('STL-035');
  });
});
