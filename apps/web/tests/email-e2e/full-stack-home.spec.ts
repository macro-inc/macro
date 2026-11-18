// Mail on Home, on the local stack: Home lists the inbox's important mail
// beside documents, channels and chats, filters to it, opens a thread beside
// the list and marks it done. And the Focus tab of the mail list, in either
// of its two orders.

import type { Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { rowIds } from './harness/list';
import { anInbox, PROVIDERS } from './harness/providers';
import type { ProviderMessage } from './harness/stack';
import { confirmed, did, saw } from './ledger/record';

function home(page: Page) {
  return page.getByRole('grid', { name: 'Home' });
}

/** The row of a thread on Home. */
function homeRow(page: Page, threadId: string) {
  return home(page).locator(`[data-soup-entity][id*="${threadId}"]`);
}

/** What Home lists, top to bottom: the kind of each row and what it is of. */
function homeRows(page: Page): Promise<string[]> {
  return home(page)
    .locator('[role="row"][data-soup-entity]')
    .evaluateAll((rows) =>
      rows.map((row) => {
        const [, kind, id] =
          /\|s\d+:entity\|s\d+:([a-z_]+)\|s36:([0-9a-f-]{36})/.exec(row.id) ??
          [];
        return `${kind} ${id}`;
      })
    );
}

/** The message with this subject, as the provider holds it. */
async function atProvider(
  mailbox: Mailbox,
  subject: string
): Promise<ProviderMessage | undefined> {
  return (await mailbox.providerMessages()).find(
    (message) => message.subject === subject
  );
}

/**
 * Puts a message in the mailbox that the provider received at `date`: the
 * order of the list goes by it, and Outlook dates mail to the second.
 */
async function deliverDated(
  mailbox: Mailbox,
  mail: { from: string; subject: string; text: string },
  date: Date
): Promise<void> {
  const { gmailUrl, outlookUrl } = mailbox.stack.info;
  const gmail = mailbox.inbox.provider === 'GMAIL';
  const base = `${gmail ? gmailUrl : outlookUrl}/_emulator/mailboxes/${encodeURIComponent(
    mailbox.inbox.email
  )}`;
  const delivered = await fetch(`${base}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...mail, date: date.toISOString() }),
  });
  expect(delivered.ok).toBe(true);
  // Gmail announces what the test puts there only when asked.
  if (gmail) {
    const pushed = await fetch(`${base}/push`, { method: 'POST' });
    expect(pushed.ok).toBe(true);
  }
}

/**
 * Has the thread in Focus with this importance, as the worker that reads
 * mail for Focus would leave it: the local stack does not run that worker.
 */
async function inFocus(
  mailbox: Mailbox,
  threadId: string,
  importance: number
): Promise<void> {
  const rows = await mailbox.stack.sql(
    `INSERT INTO email_thread_focus (
       thread_id, link_id, classified_message_id, classified_message_ts,
       is_focus, category, importance, needs_reply, needs_follow_up, scores,
       model, classified_at)
     SELECT t.id, t.link_id, m.id, COALESCE(m.internal_date_ts, m.created_at),
            true, 'known', ${importance}, false, false, '{}'::jsonb,
            'email-e2e', now()
     FROM email_threads t
     JOIN LATERAL (
       SELECT id, internal_date_ts, created_at FROM email_messages
       WHERE thread_id = t.id ORDER BY created_at DESC LIMIT 1
     ) m ON true
     WHERE t.id = '${threadId}' AND t.link_id = '${mailbox.inbox.linkId}'
     RETURNING thread_id`
  );
  expect(rows).toHaveLength(1);
}

/** Picks an order from the Focus tab's "Sort Focus" menu. */
async function sortFocus(page: Page, order: 'Most recent' | 'Importance') {
  await page.getByRole('button', { name: 'Sort Focus' }).click();
  await page.getByRole('menuitemradio', { name: order }).click();
  did('AL-034');
}

for (const provider of PROVIDERS) {
  test.describe(`mail on Home, with ${anInbox(provider)}`, {
    tag: '@full-stack',
  }, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, mail is missing from Home, Home's "Email" filter no
    // longer narrows the feed to it, a thread clicked on Home does not open
    // beside the list, or Mark done on Home leaves the thread in the inbox
    // at the provider.
    test('an email on Home is filtered to, opened and marked done', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject: 'Lunch?',
        text: 'Noon at the quarry?',
      });
      const lunch = await mailbox.synced('Lunch?');
      await mailbox.deliver({
        from: 'Linus <linus@example.com>',
        subject: 'Agenda',
        text: 'Three items for Monday.',
      });
      const agenda = await mailbox.synced('Agenda');

      await mailbox.open('/app/home');
      for (const [thread, subject] of [
        [lunch, 'Lunch?'],
        [agenda, 'Agenda'],
      ] as const) {
        await expect(homeRow(page, thread.id)).toContainText(subject);
        await expect(
          homeRow(page, thread.id).getByLabel('Unread')
        ).toBeVisible();
      }
      saw('STX-971');
      // A new account's own documents and channels are listed with the mail.
      expect(
        (await homeRows(page)).some((row) => !row.startsWith('email '))
      ).toBe(true);

      await page.getByRole('button', { name: 'Filter Home' }).click();
      await page.getByRole('menuitem', { name: 'Type' }).click();
      // "Only" shows on the row the pointer is over.
      const email = page.getByRole('menuitemcheckbox', { name: 'Email' });
      await email.hover();
      await email.getByRole('button', { name: 'Select only Email' }).click();
      did('AX-315');
      await expect
        .poll(() => homeRows(page))
        .toEqual([`email ${agenda.id}`, `email ${lunch.id}`]);
      saw('STX-972');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toHaveCount(0);

      await homeRow(page, lunch.id).click();
      did('AX-057');
      await expect(page).toHaveURL(new RegExp(`/app/home/email/${lunch.id}`));
      const opened = page.getByRole('main');
      await expect(
        opened.getByRole('heading', { name: 'Lunch?' })
      ).toBeVisible();
      await expect(opened.getByText('Noon at the quarry?')).toBeVisible();
      await expect(homeRow(page, agenda.id)).toBeVisible();
      saw('STX-973');
      // Opening it read it, at the provider too.
      await expect
        .poll(async () => (await atProvider(mailbox, 'Lunch?'))?.read)
        .toBe(true);
      await expect(homeRow(page, lunch.id).getByLabel('Unread')).toBeHidden();
      confirmed('F-164');

      // The list keeps the keyboard, with its cursor on the open thread.
      await page.keyboard.press('e');
      did('AX-314');
      await expect(homeRow(page, lunch.id)).toBeHidden();
      await expect.poll(() => homeRows(page)).toEqual([`email ${agenda.id}`]);
      saw('STX-974');
      await expect
        .poll(async () => (await atProvider(mailbox, 'Lunch?'))?.inInbox)
        .toBe(false);
      expect((await atProvider(mailbox, 'Agenda'))?.inInbox).toBe(true);
      confirmed('F-164');

      // The same from the row's own menu, which leaves the filter nothing.
      await homeRow(page, agenda.id).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Mark done' }).click();
      did('AX-314');
      await expect(
        page.getByText('No items matching the filters')
      ).toBeVisible();
      await expect(homeRow(page, agenda.id)).toBeHidden();
      saw('STX-974');
      await expect
        .poll(async () => (await atProvider(mailbox, 'Agenda'))?.inInbox)
        .toBe(false);
      confirmed('F-164');
    });
  });

  test.describe(`the Focus tab, with ${anInbox(provider)}`, {
    tag: '@any-stack',
  }, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, the Focus tab's "Sort Focus" menu does not reorder
    // the list: it stays newest first when Importance is picked, or does not
    // return to newest first.
    test('the Focus tab is sorted by importance, and back to most recent', async ({
      page,
      mailbox,
    }) => {
      // Oldest first, an hour apart; the oldest matters most.
      const mail = [
        { from: 'Grace <grace@example.com>', subject: 'Lunch?', text: 'Noon?' },
        {
          from: 'Linus <linus@example.com>',
          subject: 'Agenda',
          text: 'Three.',
        },
        { from: 'Bob <bob@example.com>', subject: 'Budget', text: 'Attached.' },
      ];
      const hour = 3_600_000;
      const threads: string[] = [];
      for (const [index, each] of mail.entries()) {
        await deliverDated(
          mailbox,
          each,
          new Date(Date.now() - (mail.length - index) * hour)
        );
        threads.push((await mailbox.synced(each.subject)).id);
      }
      const [lunch, agenda, budget] = threads;
      await inFocus(mailbox, lunch, 90);
      await inFocus(mailbox, agenda, 10);
      await inFocus(mailbox, budget, 50);

      await mailbox.open();
      const tabs = page.getByRole('radiogroup', { name: 'Inbox view' });
      await tabs.getByText('Focus', { exact: true }).click();
      await expect(tabs.getByRole('radio', { name: 'Focus' })).toBeChecked();
      await expect.poll(() => rowIds(page)).toEqual([budget, agenda, lunch]);

      await sortFocus(page, 'Importance');
      await expect.poll(() => rowIds(page)).toEqual([lunch, budget, agenda]);
      await expect(
        page.getByRole('img', { name: 'Importance 90 of 100' })
      ).toBeVisible();
      saw('STL-926');

      await sortFocus(page, 'Most recent');
      await expect.poll(() => rowIds(page)).toEqual([budget, agenda, lunch]);
      saw('STL-926');
    });
  });
}
