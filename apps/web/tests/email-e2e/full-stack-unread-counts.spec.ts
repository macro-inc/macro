// The unread numbers beside Mail, Chat and Notifications in the navigation
// rail and the phone dock, against what each view itself shows as unread, on
// the local stack: mail in one inbox and several, backfilled mail, a thread
// of several messages, mail read at the provider or in another tab, done
// mail, a list longer than a page, a shared inbox, conversations with top
// level messages, mentions and thread replies, and the "New email" switch.
//
// Each step waits for the view to show what the step made unread, then for
// the number to agree with what the view shows. A number that never agrees
// fails the test softly, so one run lists every disagreement; with
// EMAIL_E2E_UNREAD_COUNTS_OUT set to a directory, each test also writes what
// it saw there, for a table.

import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import type { SignedInUser } from './harness/front';
import { deliverNoise } from './harness/list';
import { askAs } from './harness/local-stack';
import type { Mail } from './harness/stack';
import { shareInbox } from './harness/states-settings';
import { changeAtProvider } from './harness/sync';

// Each test's recording is part of the proof of what the numbers read.
test.use({ video: { mode: 'on', size: { width: 1280, height: 720 } } });

type NavView = 'home' | 'mail' | 'channels' | 'notifications';

type Observation = {
  step: string;
  view: NavView;
  /** How many items the view marks unread. */
  viewUnread: number;
  /** The label the number should read: the view's count, unless noted. */
  expected: string;
  /** The label the number read once it settled, or after the wait. */
  shown: string;
  note?: string;
};

type CheckOptions = {
  /** The label the number should read for the view's count, when not its label. */
  expected?: (viewUnread: number) => string;
  note?: string;
};

/** The label `unreadLabel` gives a count: none at 0, `99+` past 99. */
function label(count: number): string {
  if (count <= 0) return '';
  return count > 99 ? '99+' : String(count);
}

/** The dock's name for each view, on a phone. */
const DOCK_LABEL: Record<NavView, string> = {
  home: 'Notifications',
  notifications: 'Notifications',
  mail: 'Email',
  channels: 'Chat',
};

/** The number beside a view in the rail (or the phone's dock), as shown. */
async function shown(page: Page, view: NavView): Promise<string> {
  const phone = (page.viewportSize()?.width ?? 1280) < 640;
  const item = phone
    ? page.locator(`button[aria-label="${DOCK_LABEL[view]}"]`)
    : page.locator(`[data-sidebar-next-item="${view}"]`);
  if ((await item.count()) === 0) return 'no item';
  return (await item.first().getAttribute('data-unread-count')) ?? '';
}

/** What a test saw, written as it goes so a failed run keeps it. */
function observations(testInfo: TestInfo) {
  const rows: Observation[] = [];
  const dir = process.env.EMAIL_E2E_UNREAD_COUNTS_OUT ?? testInfo.outputPath();
  const file = join(
    dir,
    `${testInfo.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`
  );
  return {
    /**
     * Waits for the number beside `view` to read what the view shows, as
     * `measure` counts it then, and records both.
     */
    async check(
      page: Page,
      step: string,
      view: NavView,
      measure: () => Promise<number>,
      options: CheckOptions = {}
    ): Promise<void> {
      const expectedFor = options.expected ?? label;
      let seen = { viewUnread: -1, expected: '', shown: '' };
      await expect
        .soft(async () => {
          const viewUnread = await measure();
          seen = {
            viewUnread,
            expected: expectedFor(viewUnread),
            shown: await shown(page, view),
          };
          expect(seen.shown).toBe(seen.expected);
        }, `${step}: the ${view} number reads what the view shows`)
        .toPass({ timeout: 20_000 });
      rows.push({ step, view, ...seen, note: options.note });
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        file,
        JSON.stringify({ test: testInfo.title, rows }, null, 2)
      );
    },
  };
}

function mailList(page: Page) {
  return page.getByRole('grid', { name: 'Email' });
}

/**
 * How many threads the mail list marks unread. `scroll` walks the whole
 * list, which renders only the rows near its viewport.
 */
function mailUnread(page: Page, scroll = false): Promise<number> {
  return mailList(page)
    .evaluate(async (grid, walk) => {
      const ids = new Set<string>();
      const read = () => {
        for (const row of grid.querySelectorAll('[data-soup-entity]')) {
          if (!row.querySelector('[role="img"][aria-label="Unread"]')) continue;
          ids.add(
            row
              .querySelector('[data-entity-id]')
              ?.getAttribute('data-entity-id') ?? row.id
          );
        }
      };
      read();
      if (!walk) return ids.size;
      const scrolls = (element: Element) =>
        element.scrollHeight > element.clientHeight + 1 &&
        /auto|scroll/.test(getComputedStyle(element).overflowY);
      const scroller = [...grid.querySelectorAll('*')].find(scrolls);
      if (!scroller) return ids.size;
      for (
        let top = 0;
        top <= scroller.scrollHeight;
        top += scroller.clientHeight / 2
      ) {
        scroller.scrollTop = top;
        await new Promise((resolve) => setTimeout(resolve, 150));
        read();
      }
      scroller.scrollTop = 0;
      return ids.size;
    }, scroll)
    .catch(() => -1);
}

/** The Mail list's row of a thread. */
function mailRow(page: Page, subject: string) {
  return mailList(page).locator('[data-soup-entity]').filter({
    hasText: subject,
  });
}

function notificationsGrid(page: Page) {
  return page.getByRole('grid', { name: 'Notifications' });
}

/** The Notifications list's top-level rows that it marks unread, by text. */
function notificationsUnreadRows(page: Page): Promise<string[]> {
  return notificationsGrid(page)
    .evaluate((grid) =>
      [...grid.querySelectorAll('[data-notification-row]')]
        .filter((row) =>
          row.querySelector(
            ':scope > [role="gridcell"] > span > [data-unread-dot]'
          )
        )
        .map((row) => row.textContent ?? '')
    )
    .catch(() => []);
}

async function notificationsUnread(page: Page): Promise<number> {
  return (await notificationsUnreadRows(page)).length;
}

type ChatRow = { name: string; dot: boolean; mentions: boolean };

/**
 * The conversations Chat's sidebar marks: with the unread dot, or with a
 * count of unread mentions in its place. A conversation listed in two
 * sections counts once.
 */
async function chatMarked(page: Page): Promise<ChatRow[]> {
  const rows = await page
    .locator('[role="treeitem"]')
    .evaluateAll((items) =>
      items
        .filter((item) => !item.querySelector('[role="treeitem"]'))
        .map((item) => ({
          key:
            /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.exec(
              item.id
            )?.[0] ??
            item.textContent ??
            '',
          name: item.textContent ?? '',
          dot: !!item.querySelector('[aria-label="Unread"]'),
          mentions: !!item.querySelector(
            '[role="img"][aria-label*="unread mention"]'
          ),
        }))
    )
    .catch(() => []);
  const byKey = new Map<string, ChatRow>();
  for (const { key, ...row } of rows) {
    if (!row.dot && !row.mentions) continue;
    byKey.set(key, row);
  }
  return [...byKey.values()];
}

async function chatMarkedCount(page: Page): Promise<number> {
  return (await chatMarked(page)).length;
}

async function chatRow(page: Page, name: string): Promise<ChatRow | undefined> {
  return (await chatMarked(page)).find((row) => row.name.includes(name));
}

async function messagesIn(mailbox: Mailbox, threadId: string): Promise<number> {
  const answer = await mailbox.api(`/email/email/threads/${threadId}`);
  if (!answer.ok) return 0;
  const body = (await answer.json()) as { thread: { messages: unknown[] } };
  return body.thread.messages.length;
}

/** How many threads the email service lists in the user's inboxes. */
async function inboxCount(mailbox: Mailbox): Promise<number> {
  let count = 0;
  let cursor = '';
  do {
    const answer = await mailbox.api(
      `/email/email/threads/previews/cursor/inbox?limit=100${cursor}`
    );
    const page = (await answer.json()) as {
      items?: unknown[];
      next_cursor?: string | null;
    };
    count += page.items?.length ?? 0;
    cursor = page.next_cursor
      ? `&cursor=${encodeURIComponent(page.next_cursor)}`
      : '';
  } while (cursor);
  return count;
}

/** The "New email" switch in Settings, Notifications. */
function newEmailSwitch(page: Page) {
  return page
    .locator('[data-settings-target]')
    .filter({ hasText: 'When a new email arrives' })
    .getByRole('switch');
}

/** Flips "New email" in Settings the way a pointer does, on its track. */
async function setNewEmail(mailbox: Mailbox, page: Page, on: boolean) {
  await mailbox.open('/app/mail/~/settings/notifications');
  const toggle = newEmailSwitch(page);
  await expect(toggle).toBeEnabled();
  await expect(toggle).toBeChecked({ checked: !on });
  await toggle.locator('xpath=following-sibling::div[1]').click();
  await expect(toggle).toBeChecked({ checked: on });
  await expect
    .poll(async () => {
      const answer = await mailbox.api(
        '/notification/user_notifications/preferences'
      );
      const body = (await answer.json()) as { disabled_types: string[] };
      return body.disabled_types.includes('new_email');
    })
    .toBe(!on);
}

const JSON_BODY = { 'content-type': 'application/json' };

async function createChannel(
  owner: SignedInUser,
  name: string,
  members: SignedInUser[]
): Promise<string> {
  const answer = await askAs(owner, '/dss/channels', {
    method: 'POST',
    headers: JSON_BODY,
    body: JSON.stringify({
      channel_type: 'private',
      name,
      participants: members.map((member) => member.macroUserId),
      team_id: null,
    }),
  });
  expect(answer.status, answer.body.toString('utf8')).toBeLessThan(300);
  return (JSON.parse(answer.body.toString('utf8')) as { id: string }).id;
}

/** Posts a message as `author`: top level, or a reply in `threadId`. */
async function post(
  author: SignedInUser,
  channelId: string,
  text: string,
  options: { mention?: SignedInUser; threadId?: string } = {}
): Promise<string> {
  const mention = options.mention;
  const answer = await askAs(author, `/dss/messages/channel/${channelId}`, {
    method: 'POST',
    headers: JSON_BODY,
    body: JSON.stringify({
      content: mention
        ? `<m-user-mention>${JSON.stringify({ userId: mention.macroUserId })}</m-user-mention> ${text}`
        : text,
      mentions: mention
        ? [{ entity_type: 'user', entity_id: mention.macroUserId }]
        : [],
      attachments: [],
      thread_id: options.threadId ?? null,
      nonce: randomUUID(),
      notification_policy: 'Default',
    }),
  });
  expect(answer.status, answer.body.toString('utf8')).toBeLessThan(300);
  return (JSON.parse(answer.body.toString('utf8')) as { id: string }).id;
}

function from(name: string): string {
  return `${name} <${name.toLowerCase()}@example.com>`;
}

function mail(subject: string, sender = 'Grace'): Mail {
  return { from: from(sender), subject, text: `About ${subject}.` };
}

test.describe('the unread numbers beside each view', {
  tag: '@full-stack',
}, () => {
  test.use({ provider: 'GMAIL' });
  test.beforeEach(({ page }) => loadAppSteadily(page));

  test('Mail counts its unread threads as mail arrives, is read elsewhere and is done', async ({
    page,
    mailbox,
  }, testInfo) => {
    test.setTimeout(300_000);
    const seen = observations(testInfo);
    const unread = () => mailUnread(page);
    await mailbox.open('/app/mail');
    await expect(mailList(page)).toBeVisible();
    await seen.check(page, 'nothing unread', 'mail', unread);

    await mailbox.deliver({
      ...mail('Lunch?'),
      messageId: 'lunch-1@example.com',
    });
    const lunch = await mailbox.synced('Lunch?');
    await expect.poll(unread).toBe(1);
    await seen.check(page, 'one unread thread', 'mail', unread);

    await mailbox.deliver({
      ...mail('Re: Lunch?', 'Linus'),
      messageId: 'lunch-2@example.com',
      inReplyTo: 'lunch-1@example.com',
    });
    await mailbox.deliver({
      ...mail('Re: Lunch?', 'Grace'),
      messageId: 'lunch-3@example.com',
      inReplyTo: 'lunch-2@example.com',
    });
    await expect
      .poll(() => messagesIn(mailbox, lunch.id), { timeout: 60_000 })
      .toBe(3);
    await expect.poll(unread).toBe(1);
    await seen.check(
      page,
      'one thread of three unread messages',
      'mail',
      unread
    );

    const agenda = await mailbox.deliver(mail('Agenda'));
    await mailbox.deliver(mail('Budget', 'Linus'));
    const budget = await mailbox.synced('Budget');
    await mailbox.synced('Agenda');
    await expect.poll(unread).toBe(3);
    await seen.check(page, 'three unread threads', 'mail', unread);

    await changeAtProvider(mailbox, agenda.id, { read: true });
    await expect.poll(unread, { timeout: 60_000 }).toBe(2);
    await seen.check(
      page,
      'one read on another device (at Gmail)',
      'mail',
      unread
    );

    const other = await page.context().newPage();
    await other.goto(`${mailbox.front.origin}/app/mail/${budget.id}`);
    await expect(
      other.getByRole('heading', { name: 'Budget' }).first()
    ).toBeVisible();
    await expect.poll(unread, { timeout: 60_000 }).toBe(1);
    await seen.check(page, 'one read in another tab', 'mail', unread);
    await other.close();

    const invoice = await mailbox.deliver(mail('Invoice', 'Linus'));
    await mailbox.synced('Invoice');
    await expect.poll(unread).toBe(2);
    await seen.check(page, 'one more unread thread', 'mail', unread);
    await changeAtProvider(mailbox, invoice.id, { archived: true });
    await expect(mailRow(page, 'Invoice')).toBeHidden({ timeout: 60_000 });
    await expect.poll(unread).toBe(1);
    await seen.check(
      page,
      'one archived on another device (at Gmail)',
      'mail',
      unread
    );

    await mailRow(page, 'Lunch?').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Mark done' }).click();
    await expect(mailRow(page, 'Lunch?')).toBeHidden();
    await expect.poll(unread).toBe(0);
    await seen.check(page, 'the last one marked done', 'mail', unread);
  });

  test('Mail counts backfilled mail, a second inbox, and leaves out Other', async ({
    page,
    mailbox,
  }, testInfo) => {
    test.setTimeout(300_000);
    const seen = observations(testInfo);
    const unread = () => mailUnread(page);
    const work = 'work@example.com';
    await mailbox.stack.seed('GMAIL', work, [
      mail('Quarterly plan'),
      mail('Offsite', 'Linus'),
      mail('Hiring', 'Ada'),
    ]);
    const workInbox = await mailbox.stack.link(mailbox.user, 'GMAIL', work);
    await expect.poll(() => inboxCount(mailbox), { timeout: 120_000 }).toBe(3);
    await mailbox.open('/app/mail');
    await expect.poll(unread, { timeout: 60_000 }).toBe(3);
    await seen.check(
      page,
      'three backfilled unread threads in a second inbox',
      'mail',
      unread
    );

    await mailbox.deliver(mail('Lunch?'));
    await mailbox.stack.deliver(
      workInbox.email,
      mail('Standup notes', 'Linus')
    );
    await mailbox.synced('Lunch?');
    await expect.poll(unread, { timeout: 60_000 }).toBe(5);
    await seen.check(page, 'new mail in each inbox', 'mail', unread);

    await deliverNoise(mailbox, mail('Big sale', 'Shop'));
    await mailbox.synced('Big sale');
    await expect(mailRow(page, 'Big sale')).toHaveCount(0);
    await expect.poll(unread).toBe(5);
    await seen.check(page, 'unread mail filed under Other', 'mail', unread, {
      note: 'Other is not the Important tab Mail opens on',
    });
  });

  test('Mail reads 99+ for more unread threads than a page holds', async ({
    page,
    mailbox,
  }, testInfo) => {
    test.setTimeout(420_000);
    const seen = observations(testInfo);
    const many = 'notes@example.com';
    await mailbox.stack.seed(
      'GMAIL',
      many,
      Array.from({ length: 105 }, (_, index) =>
        mail(`Note ${String(index + 1).padStart(3, '0')}`)
      )
    );
    await mailbox.stack.link(mailbox.user, 'GMAIL', many);
    await expect
      .poll(() => inboxCount(mailbox), { timeout: 240_000 })
      .toBe(105);
    await mailbox.open('/app/mail');
    await expect
      .poll(() => mailUnread(page, true), { timeout: 60_000 })
      .toBeGreaterThanOrEqual(100);
    await seen.check(
      page,
      '105 unread threads, 100 on the first page',
      'mail',
      () => mailUnread(page, true),
      { note: 'the list shows its first 100 threads, then Load More' }
    );
  });

  test('Mail counts the unread mail of an inbox shared with the user', async ({
    page,
    mailbox,
  }, testInfo) => {
    test.setTimeout(300_000);
    const seen = observations(testInfo);
    const unread = () => mailUnread(page);
    const team = mailbox.stack.address('team@example.com');
    await shareInbox(mailbox, team);
    await mailbox.open('/app/mail');
    await expect(mailList(page)).toBeVisible();

    await mailbox.stack.deliver(team, mail('Customer question'));
    await mailbox.stack.deliver(team, mail('Invoice', 'Linus'));
    await expect.poll(unread, { timeout: 90_000 }).toBe(2);
    await seen.check(
      page,
      'two unread threads in a shared inbox',
      'mail',
      unread
    );

    await mailbox.deliver(mail('Lunch?'));
    await expect.poll(unread, { timeout: 60_000 }).toBe(3);
    await seen.check(page, 'and one in the user’s own inbox', 'mail', unread);
  });

  test('Mail has no number while "New email" notifications are off', async ({
    page,
    mailbox,
  }, testInfo) => {
    test.setTimeout(300_000);
    const seen = observations(testInfo);
    const unread = () => mailUnread(page);
    await mailbox.deliver(mail('Lunch?'));
    await mailbox.deliver(mail('Agenda', 'Linus'));
    await mailbox.synced('Agenda');
    await mailbox.open('/app/mail');
    await expect.poll(unread, { timeout: 60_000 }).toBe(2);
    await seen.check(page, '"New email" on', 'mail', unread);

    await setNewEmail(mailbox, page, false);
    await mailbox.open('/app/mail');
    await expect.poll(unread, { timeout: 60_000 }).toBe(2);
    await seen.check(page, '"New email" off', 'mail', unread, {
      expected: () => '',
      note: 'no number on purpose: the person asked not to be told about new mail',
    });

    await setNewEmail(mailbox, page, true);
    await mailbox.open('/app/mail');
    await expect.poll(unread, { timeout: 60_000 }).toBe(2);
    await seen.check(page, '"New email" on again', 'mail', unread);
  });

  test('Chat counts conversations with an unread message, not mentions in threads', async ({
    page,
    mailbox,
  }, testInfo) => {
    test.setTimeout(300_000);
    const seen = observations(testInfo);
    const ada = mailbox.user;
    const bob = await mailbox.stack.user(
      mailbox.stack.address('bob@example.com')
    );
    const marked = () => chatMarkedCount(page);

    const lunch = await createChannel(bob, 'Lunch crew', [ada]);
    const design = await createChannel(bob, 'Design review', [ada]);
    const standup = await createChannel(bob, 'Standup', [ada]);
    await mailbox.open('/app/channels');
    await expect(
      page.getByRole('treeitem').filter({ hasText: 'Standup' }).first()
    ).toBeVisible({ timeout: 60_000 });
    await seen.check(page, 'three new conversations', 'channels', marked, {
      note: 'a welcome message the stack sends new users can be unread here',
    });

    await post(bob, lunch, 'Tacos at noon?');
    await post(bob, lunch, 'Or pizza.');
    await expect
      .poll(async () => (await chatRow(page, 'Lunch crew'))?.dot, {
        timeout: 60_000,
      })
      .toBe(true);
    await seen.check(
      page,
      'two unread messages in one conversation',
      'channels',
      marked
    );

    await post(bob, design, 'Can you look at the mockups?', { mention: ada });
    await expect
      .poll(async () => !!(await chatRow(page, 'Design review')), {
        timeout: 60_000,
      })
      .toBe(true);
    await seen.check(
      page,
      'a message that mentions the user, in a second conversation',
      'channels',
      marked,
      { note: 'its row shows the mention count in place of the dot' }
    );

    const root = await post(ada, standup, 'Shipping the release today.');
    await post(bob, standup, 'Nice, thanks!', { threadId: root });
    await post(bob, standup, 'I will watch the dashboards.', {
      threadId: root,
    });
    await expect.poll(() => chatRow(page, 'Standup')).toBeUndefined();
    await seen.check(
      page,
      'two thread replies to the user’s message',
      'channels',
      marked,
      { note: 'Chat marks a conversation for its top-level messages only' }
    );

    await post(bob, standup, 'Can you post the notes?', {
      threadId: root,
      mention: ada,
    });
    await expect
      .poll(async () => (await chatRow(page, 'Standup'))?.mentions, {
        timeout: 60_000,
      })
      .toBe(true);
    const leavingOutStandup = (count: number) => label(count - 1);
    await seen.check(
      page,
      'a thread reply that mentions the user',
      'channels',
      marked,
      {
        expected: leavingOutStandup,
        note: 'Standup shows a mention count for a thread reply; Chat’s Unread filter leaves it out, and so does the number',
      }
    );

    await page
      .getByRole('treeitem')
      .filter({ hasText: 'Lunch crew' })
      .first()
      .click();
    await expect
      .poll(() => chatRow(page, 'Lunch crew'), { timeout: 60_000 })
      .toBeUndefined();
    await seen.check(page, 'one conversation opened', 'channels', marked, {
      expected: leavingOutStandup,
      note: 'Standup still has only its thread mention',
    });
  });

  test('Notifications counts the rows it marks unread, mail rows included after New email is turned off', async ({
    page,
    mailbox,
  }, testInfo) => {
    test.setTimeout(300_000);
    const seen = observations(testInfo);
    const unread = () => notificationsUnread(page);
    const ada = mailbox.user;
    const bob = await mailbox.stack.user(
      mailbox.stack.address('bob@example.com')
    );
    await mailbox.deliver(mail('Lunch?'));
    await mailbox.deliver({
      ...mail('Agenda', 'Linus'),
      messageId: 'agenda-1@example.com',
    });
    const agenda = await mailbox.synced('Agenda');
    await mailbox.deliver({
      ...mail('Re: Agenda', 'Grace'),
      inReplyTo: 'agenda-1@example.com',
    });
    await expect
      .poll(() => messagesIn(mailbox, agenda.id), { timeout: 60_000 })
      .toBe(2);
    const lunchCrew = await createChannel(bob, 'Lunch crew', [ada]);
    await post(bob, lunchCrew, 'Tacos at noon?');
    await post(bob, lunchCrew, 'Or pizza.');

    await mailbox.open('/app/notifications');
    const grid = notificationsGrid(page);
    await expect(grid.getByText('Lunch crew').first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(grid.getByText('Agenda').first()).toBeVisible();
    await seen.check(
      page,
      'mail, a thread of two messages and two chat messages',
      'notifications',
      unread
    );

    await grid
      .locator('[data-notification-row]')
      .filter({ hasText: 'Lunch?' })
      .first()
      .click();
    await expect
      .poll(async () =>
        (await notificationsUnreadRows(page)).some((row) =>
          row.includes('Lunch?')
        )
      )
      .toBe(false);
    await seen.check(page, 'one row opened', 'notifications', unread);

    await setNewEmail(mailbox, page, false);
    await mailbox.open('/app/notifications');
    await expect(grid.getByText('Agenda').first()).toBeVisible({
      timeout: 60_000,
    });
    await seen.check(page, '"New email" turned off', 'notifications', unread, {
      note: 'the inbox still lists mail rows made before the switch',
    });

    await mailbox.deliver(mail('Budget', 'Linus'));
    await mailbox.synced('Budget');
    await expect(grid.getByText('Budget')).toHaveCount(0);
    await seen.check(
      page,
      'mail that arrives while it is off',
      'notifications',
      unread,
      { note: 'no row is made for it' }
    );
  });

  test.describe('on a phone', () => {
    test.use({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });

    test('the dock counts Email and Notifications as their views show them', async ({
      page,
      mailbox,
    }, testInfo) => {
      test.setTimeout(300_000);
      const seen = observations(testInfo);
      const ada = mailbox.user;
      const bob = await mailbox.stack.user(
        mailbox.stack.address('bob@example.com')
      );
      await mailbox.deliver(mail('Lunch?'));
      await mailbox.deliver(mail('Agenda', 'Linus'));
      await mailbox.synced('Agenda');
      const lunchCrew = await createChannel(bob, 'Lunch crew', [ada]);
      await post(bob, lunchCrew, 'Tacos at noon?');

      await mailbox.open('/app/mail');
      await expect.poll(() => mailUnread(page), { timeout: 60_000 }).toBe(2);
      await seen.check(page, 'two unread threads', 'mail', () =>
        mailUnread(page)
      );

      await mailbox.open('/app/notifications');
      await expect(
        notificationsGrid(page).getByText('Lunch crew').first()
      ).toBeVisible({ timeout: 60_000 });
      await seen.check(
        page,
        'two mail rows and a chat message',
        'home',
        () => notificationsUnread(page),
        {
          note: 'the dock’s Notifications button stands for the Notifications view',
        }
      );
    });
  });
});
