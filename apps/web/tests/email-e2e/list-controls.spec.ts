// The controls around the mail list: the Shared with me view, the next page
// of a long list, a pull to refresh on a phone, and hiding the Email
// sidebar. Each for a Gmail and an Outlook inbox.

import { devices, type Page, type Request } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { catchUpFinished, focusedRowId, rowIds } from './harness/list';
import { anInbox, PROVIDERS } from './harness/providers';
import type { Mail } from './harness/stack';
import { confirmed, did, saw } from './ledger/record';

const { defaultBrowserType: _browser, ...phone } = devices['iPhone 13'];

/** More threads than one page of the list holds (100). */
const LONG_LIST = 104;

type PreviewPage = { items: { id: string }[]; next_cursor: string | null };

/** A page of the inbox as the email service answers it. */
async function inboxPage(
  mailbox: Mailbox,
  cursor?: string
): Promise<PreviewPage> {
  const query = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
  const response = await mailbox.api(
    `/email/email/threads/previews/cursor/inbox?limit=100${query}`
  );
  const page = (await response.json()) as Partial<PreviewPage>;
  return { items: page.items ?? [], next_cursor: page.next_cursor ?? null };
}

/**
 * Whether a request of the browser is the list asking the storage service
 * for its threads, with `filter` in what it asks for.
 */
function listQuery(request: Request, filter: string): boolean {
  if (request.method() !== 'POST') return false;
  if (!new URL(request.url()).pathname.endsWith('/graphql')) return false;
  const body = request.postData() ?? '';
  return body.includes('"operationName":"Soup"') && body.includes(filter);
}

/** Moves the list's cursor with `key` and answers the row it lands on. */
async function moveCursor(page: Page, key: string): Promise<string> {
  const from = await focusedRowId(page);
  await page.keyboard.press(key);
  let to: string | undefined;
  await expect
    .poll(async () => {
      to = await focusedRowId(page);
      return to !== undefined && to !== from;
    })
    .toBe(true);
  if (!to) throw new Error('the cursor is on no row');
  return to;
}

/**
 * Walks the list's cursor from the row it is on up to `first` and answers
 * the thread ids it passed: the list renders only the rows in view.
 */
async function walkUp(page: Page, first: string): Promise<string[]> {
  const from = await focusedRowId(page);
  if (!from) throw new Error('the cursor is on no row');
  const ids = [from];
  while (ids[ids.length - 1] !== first) {
    if (ids.length > 2 * LONG_LIST) throw new Error('the list has no top');
    ids.push(await moveCursor(page, 'k'));
  }
  return ids;
}

/** Pulls the list down with a finger and lets go. */
async function pullDown(page: Page): Promise<void> {
  const box = await page.getByRole('grid', { name: 'Email' }).boundingBox();
  if (!box) throw new Error('no list');
  const x = box.x + box.width / 2;
  const top = box.y + 80;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y: top }],
  });
  for (let moved = 25; moved <= 260; moved += 25) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: top + moved }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await cdp.detach();
}

for (const provider of PROVIDERS) {
  test.describe(`the controls of the mail list of ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, a thread someone else shared is missing from Shared,
    // or Shared lists the user's own mail too.
    test('Shared lists the thread another person shared, and none of the own mail', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject: 'Agenda',
        text: 'About Agenda.',
      });
      const agenda = await mailbox.synced('Agenda');
      // Another person's inbox, with a thread of theirs.
      const bob = await mailbox.stack.user('bob@example.com');
      const bobInbox = await mailbox.stack.link(bob, provider);
      await mailbox.stack.deliver('bob@example.com', {
        from: 'Hugo <hugo@example.com>',
        subject: 'Budget',
        text: 'About Budget.',
      });
      let theirs: { id: string }[] = [];
      await expect
        .poll(
          async () => {
            theirs = await mailbox.stack.sql<{ id: string }>(
              `SELECT t.id FROM email_threads t JOIN email_links l ON l.id = t.link_id WHERE l.email_address = 'bob@example.com'`
            );
            return theirs.length;
          },
          { timeout: 60_000 }
        )
        .toBe(1);
      const budget = theirs[0].id;
      const read = () => mailbox.api(`/email/email/threads/${budget}?limit=1`);
      expect((await read()).status).toBe(401);
      // The grant the Share dialog leaves, written directly: sharing with a
      // person goes through services this stack does not run.
      await mailbox.stack.sql(
        `INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES ('${budget}'::uuid, 'email_thread', '${mailbox.user.macroUserId}', 'user', 'view') RETURNING entity_id`
      );
      const granted = await read();
      expect(granted.status).toBe(200);
      const { thread } = (await granted.json()) as {
        thread: { access_level: string; link_id: string };
      };
      expect(thread.access_level).toBe('view');
      expect(thread.link_id).toBe(bobInbox.linkId);

      await mailbox.open();
      await expect.poll(() => rowIds(page)).toEqual([agenda.id]);
      const sharedList = page.waitForResponse((response) =>
        listQuery(response.request(), '"shared":"ONLY"')
      );
      await page
        .getByRole('navigation', { name: 'Email library' })
        .getByRole('button', { name: 'Shared' })
        .click();
      did('AL-002', 'F-032');
      await expect.poll(() => rowIds(page)).toEqual([budget]);
      await expect(
        page
          .getByRole('grid', { name: 'Email' })
          .getByText('Budget', { exact: true })
      ).toBeVisible();
      await expect(page).toHaveURL(/mail\.tab=shared/);
      saw('STL-925');

      // What the service answered the Shared tab: the thread shared with
      // the user, and none of their own.
      const listed = (await (await sharedList).json()) as {
        data: { user: { soup: { items: { id: string; ownerId: string }[] } } };
      };
      expect(
        listed.data.user.soup.items.map(({ id, ownerId }) => ({ id, ownerId }))
      ).toEqual([{ id: budget, ownerId: bob.macroUserId }]);
      confirmed('F-032');
    });

    // When this fails, a list longer than a page stops at its first page:
    // moving the cursor past its end loads nothing, or the next page never
    // joins the list.
    test('moving the cursor past the end of a long list loads its next page', async ({
      page,
      mailbox,
    }) => {
      test.setTimeout(180_000);
      const notes: Mail[] = Array.from({ length: LONG_LIST }, (_, index) => ({
        from: 'Grace <grace@example.com>',
        subject: `Note ${String(index + 1).padStart(3, '0')}`,
        text: `Body ${index + 1}.`,
      }));
      await mailbox.stack.seed(provider, 'notes@example.com', notes);
      await mailbox.stack.link(mailbox.user, provider, 'notes@example.com');
      let first: PreviewPage = { items: [], next_cursor: null };
      let second: PreviewPage = { items: [], next_cursor: null };
      await expect
        .poll(
          async () => {
            first = await inboxPage(mailbox);
            if (!first.next_cursor) return first.items.length;
            second = await inboxPage(mailbox, first.next_cursor);
            return first.items.length + second.items.length;
          },
          { timeout: 120_000 }
        )
        .toBe(LONG_LIST);
      const list = page.getByRole('grid', { name: 'Email' });
      const more = list.getByRole('row').filter({
        has: page.getByRole('button', { name: /^(Load More|Loading\.\.\.)$/ }),
      });

      await mailbox.open();
      await expect.poll(() => focusedRowId(page)).toBeDefined();
      const [top] = await rowIds(page);
      // The cursor goes to the last thread the list holds, and a step on.
      await page.keyboard.press('End');
      await expect.poll(() => focusedRowId(page)).not.toBe(top);
      await page.keyboard.press('j');
      did('AL-057');
      await expect(more).toHaveCount(0);
      await page.keyboard.press('Home');
      await expect.poll(() => focusedRowId(page)).toBe(top);
      await moveCursor(page, 'End');
      const all = await walkUp(page, top);
      expect(all).toHaveLength(LONG_LIST);
      // The threads of the next page come after those of the first.
      expect(all.toReversed().slice(100).toSorted()).toEqual(
        second.items.map((item) => item.id).toSorted()
      );
      saw('STL-979');

      // The service pages the same threads: a full page, then the rest.
      expect(first.items).toHaveLength(100);
      expect(second.items).toHaveLength(LONG_LIST - 100);
      expect(second.next_cursor).toBeNull();
      expect(all.toSorted()).toEqual(
        [...first.items, ...second.items].map((item) => item.id).toSorted()
      );
      confirmed('F-036');
    });

    // When this fails, the button in the sidebar's header does not hide the
    // Email sidebar, or nothing brings it back.
    test('the Email sidebar hides, and comes back', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject: 'Agenda',
        text: 'About Agenda.',
      });
      const agenda = await mailbox.synced('Agenda');
      const sidebar = page.getByRole('complementary', {
        name: 'Email navigation',
      });
      const tabs = page.getByRole('navigation', { name: 'Email tabs' });

      await mailbox.open();
      await expect.poll(() => rowIds(page)).toEqual([agenda.id]);
      await expect(tabs.getByRole('button', { name: 'Inbox' })).toBeVisible();
      await sidebar.getByRole('button', { name: 'Hide navigation' }).click();
      did('AL-409');
      await expect(sidebar).toHaveCount(0);
      await expect(tabs).toHaveCount(0);
      // The list stays.
      await expect.poll(() => rowIds(page)).toEqual([agenda.id]);

      await page.getByRole('button', { name: 'Show navigation' }).click();
      await expect(sidebar).toBeVisible();
      await expect(tabs.getByRole('button', { name: 'Inbox' })).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Show navigation' })
      ).toHaveCount(0);
      saw('STL-946');
    });
  });

  test.describe(`refreshing the mail list of ${anInbox(provider)} on a phone`, () => {
    test.use({ ...phone, provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, pulling the list down on a phone asks for nothing:
    // mail that arrived since the list loaded stays out of it.
    test('pulling the list down brings in the mail that arrived since', async ({
      page,
      mailbox,
    }) => {
      // Without the live updates, so that only the pull can bring mail in.
      await page.routeWebSocket(/\/dss\/items\/soup\/graphql\/ws/, () => {});
      await mailbox.deliver({
        from: 'Grace <grace@example.com>',
        subject: 'Agenda',
        text: 'About Agenda.',
      });
      const agenda = await mailbox.synced('Agenda');

      await mailbox.open();
      expect(await page.evaluate(() => window.innerWidth)).toBe(
        phone.viewport.width
      );
      await expect.poll(() => rowIds(page)).toEqual([agenda.id]);
      // The catch-up the app starts with would bring the mail in too.
      await expect
        .poll(() => catchUpFinished(page), { timeout: 60_000 })
        .toBe(true);
      await mailbox.deliver({
        from: 'Hugo <hugo@example.com>',
        subject: 'Minutes',
        text: 'About Minutes.',
      });
      const minutes = await mailbox.synced('Minutes');
      expect(await rowIds(page)).toEqual([agenda.id]);

      const asked = page.waitForRequest((request) =>
        listQuery(request, '"emailView":"INBOX"')
      );
      await pullDown(page);
      did('AL-058');
      // The pull asks the service for the list again.
      await asked;
      await expect.poll(() => rowIds(page)).toEqual([minutes.id, agenda.id]);
      await expect(
        page
          .getByRole('grid', { name: 'Email' })
          .getByText('Minutes', { exact: true })
      ).toBeVisible();
      saw('STL-927');
    });
  });
}
