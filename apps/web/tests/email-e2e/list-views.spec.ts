// What the mail list shows and how it is narrowed: the Inbox tabs, filters,
// the reading pane, a row and its marks, a failed load, a saved view deleted,
// stepping between threads, and the folder a thread is filed in. Each for a
// Gmail and an Outlook inbox.

import type { Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { deliverNoise, focusRow, openThreadId, rowIds } from './harness/list';
import { anInbox, PROVIDERS } from './harness/providers';
import { notice } from './harness/send';
import { confirmed, did, saw } from './ledger/record';

const from = 'Grace <grace@example.com>';

/** The row of a thread in the list. */
function row(page: Page, threadId: string) {
  return page.locator(`[data-soup-entity] [data-entity-id="${threadId}"]`);
}

/** Asks the storage service's GraphQL as the signed-in user. */
async function graphql<T>(
  mailbox: Mailbox,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const response = await mailbox.api('/dss/items/soup/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await response.json()) as { data?: T; errors?: unknown };
  if (!body.data || body.errors) {
    throw new Error(`GraphQL failed: ${JSON.stringify(body.errors)}`);
  }
  return body.data;
}

/** The names of the user's saved views, as the service holds them. */
async function savedViewNames(mailbox: Mailbox): Promise<string[]> {
  const data = await graphql<{
    user: { savedViews: { nodes: { name: string }[] } };
  }>(mailbox, 'query { user { id savedViews(first: 20) { nodes { name } } } }');
  return data.user.savedViews.nodes.map((view) => view.name);
}

for (const provider of PROVIDERS) {
  test.describe(`the mail list of ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, the Inbox tabs do not switch, or a tab lists mail
    // that belongs to the other one.
    test('Noise lists the mail the provider set aside, Signal the rest', async ({
      page,
      mailbox,
    }) => {
      await deliverNoise(mailbox, {
        from: 'Deals <deals@example.com>',
        subject: 'Sale',
        text: 'Everything must go.',
      });
      await mailbox.deliver({ from, subject: 'Lunch?', text: 'Noon?' });
      const lunch = await mailbox.synced('Lunch?');
      const sale = await mailbox.synced('Sale');
      const tabs = page.getByRole('radiogroup', { name: 'Inbox view' });

      await mailbox.open();
      await expect.poll(() => rowIds(page)).toEqual([lunch.id]);
      await tabs.getByText('Noise', { exact: true }).click();
      did('AL-003');
      await expect(tabs.getByRole('radio', { name: 'Noise' })).toBeChecked();
      await expect.poll(() => rowIds(page)).toEqual([sale.id]);
      saw('STL-922');
      await tabs.getByText('Signal', { exact: true }).click();
      await expect(tabs.getByRole('radio', { name: 'Signal' })).toBeChecked();
      await expect.poll(() => rowIds(page)).toEqual([lunch.id]);
      saw('STL-922');
    });

    // When this fails, a filter chosen in the menu does not narrow the list
    // (unread mail stays listed under "Read"), the count of active filters
    // is not shown, or clearing the filters does not bring the mail back.
    test('the Read filter empties a list of unread mail and Clear filters brings it back', async ({
      page,
      mailbox,
    }) => {
      for (const subject of ['Alpha', 'Bravo']) {
        await mailbox.deliver({ from, subject, text: `Body of ${subject}.` });
      }
      for (const subject of ['Alpha', 'Bravo']) await mailbox.synced(subject);
      const filters = page.getByRole('group', { name: 'Email filters' });

      await mailbox.open();
      await expect.poll(async () => (await rowIds(page)).length).toBe(2);
      await filters.getByRole('button', { name: 'Filter email' }).click();
      did('AL-018');
      await page.getByRole('menuitem', { name: 'Read status' }).click();
      await page
        .getByRole('menuitemradio', { name: 'Read', exact: true })
        .click();
      did('AL-020');
      await expect(
        page.getByText('No email matching the filters')
      ).toBeVisible();
      await expect.poll(() => rowIds(page)).toEqual([]);
      saw('STL-008');
      await expect(filters).toHaveText('1');
      saw('STL-027');

      // The menus may still be open over the list; Escape closes them.
      await expect(async () => {
        await page.keyboard.press('Escape');
        await expect(page.getByRole('menu')).toHaveCount(0);
      }).toPass();
      await page
        .getByRole('grid', { name: 'Email' })
        .getByRole('button', { name: 'Clear filters' })
        .click();
      did('AL-033');
      await expect.poll(async () => (await rowIds(page)).length).toBe(2);
      await expect(filters).toHaveText('');
    });

    // When this fails, the reading pane button does nothing, or with the
    // pane on a thread replaces the list instead of showing beside it.
    test('the reading pane shows the thread under the cursor beside the list', async ({
      page,
      mailbox,
    }) => {
      for (const subject of ['Alpha', 'Bravo']) {
        await mailbox.deliver({ from, subject, text: `Body of ${subject}.` });
      }
      const subjectOf = new Map<string, string>();
      for (const subject of ['Alpha', 'Bravo']) {
        subjectOf.set((await mailbox.synced(subject)).id, subject);
      }

      await page.setViewportSize({ width: 1600, height: 900 });
      await mailbox.open();
      await expect.poll(async () => (await rowIds(page)).length).toBe(2);
      const rows = await rowIds(page);
      await page.getByRole('button', { name: 'Show reading pane' }).click();
      did('AL-035');
      await expect(
        page.getByRole('button', { name: 'Hide reading pane' })
      ).toHaveAttribute('aria-pressed', 'true');
      saw('STL-026');

      await page.keyboard.press('j');
      did('AL-412');
      await expect.poll(() => openThreadId(page)).toBe(rows[1]);
      await expect(
        page
          .getByRole('paragraph')
          .filter({ hasText: `Body of ${subjectOf.get(rows[1])}.` })
      ).toBeVisible();
      await expect(row(page, rows[1])).toHaveAttribute('aria-current', 'true');
      await expect(row(page, rows[0])).not.toHaveAttribute('aria-current');
      // The list is still there, beside the thread.
      await expect(row(page, rows[0])).toBeVisible();
      saw('STL-403', 'F-040');
    });

    // When this fails, a row shows another sender or subject than its
    // thread's (the reply prefix the thread header drops, for one).
    test('a row shows the sender and the subject of its thread', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from,
        subject: 'Plain',
        text: 'Nothing special.',
      });
      await mailbox.deliver({
        from: 'Hugo <hugo@example.com>',
        subject: 'Re: Quarterly numbers',
        text: 'Numbers attached.',
      });
      await mailbox.synced('Plain');
      const numbers = await mailbox.synced('Re: Quarterly numbers');

      await mailbox.open();
      await expect(row(page, numbers.id)).toBeVisible();
      // A wide row reads sender, subject, snippet, time.
      const [sender, subject, snippet] = (
        await row(page, numbers.id).innerText()
      ).split('\n');
      expect([sender, subject, snippet]).toEqual([
        'Hugo',
        'Quarterly numbers',
        'Numbers attached.',
      ]);
      saw('STL-965');
    });

    // When this fails, a list that could not be loaded shows nothing to
    // act on, or Try again does not load it.
    test('a list that failed to load says so, and Try again loads it', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({ from, subject: 'Alpha', text: 'Body of Alpha.' });
      const alpha = await mailbox.synced('Alpha');
      // The list is read by its own request (Soup) and filled in the
      // background by others (…Backfill). The background ones stay down for
      // the whole test: they are tried again for ever, and would list the
      // thread without anyone asking.
      let failing = true;
      let lastListRequest = Date.now();
      await page.route(/\/graphql(\?|$)/, (route) => {
        const sent = route.request().postData() ?? '';
        const operation = /"operationName":"(\w+)"/.exec(sent)?.[1] ?? '';
        if (operation === 'Soup') lastListRequest = Date.now();
        if (operation.endsWith('Backfill') || (failing && operation === 'Soup'))
          return route.fulfill({ status: 500, body: '{}' });
        return route.fallback();
      });
      const list = page.getByRole('grid', { name: 'Email' });

      await mailbox.open();
      await expect(list.getByText('Email couldn’t be loaded.')).toBeVisible();
      await expect(
        list.getByRole('button', { name: 'Try again' })
      ).toBeVisible();
      saw('STL-003');
      // The app asks a few more times by itself while it already says so.
      // Once it has given up, only Try again asks again.
      await expect
        .poll(() => Date.now() - lastListRequest, { timeout: 30_000 })
        .toBeGreaterThan(5_000);
      await expect(list.getByText('Email couldn’t be loaded.')).toBeVisible();
      failing = false;
      await list.getByRole('button', { name: 'Try again' }).click();
      did('AL-059');
      await expect.poll(() => rowIds(page)).toEqual([alpha.id]);
      await expect(list.getByText('Email couldn’t be loaded.')).toHaveCount(0);
    });

    // When this fails, Delete view leaves the view in the sidebar or at the
    // service, or leaves the list on a view that no longer exists.
    test('deleting the open saved view removes it and returns to the inbox', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({ from, subject: 'Alpha', text: 'Body of Alpha.' });
      const alpha = await mailbox.synced('Alpha');
      await graphql(
        mailbox,
        'mutation ($input: CreateSavedViewInput!) { createSavedView(input: $input) { id } }',
        {
          input: {
            id: crypto.randomUUID(),
            name: 'Unread mail',
            config: {
              kind: 'email',
              version: 1,
              filters: {
                done: 'not-done',
                read: 'unread',
                tags: [],
                starred: false,
                subject: [],
                inboxIds: [],
                importance: 'signal',
                attachments: [],
                participants: [],
                calendarInvite: false,
                participantFields: ['from', 'to', 'cc'],
              },
            },
          },
        }
      );
      expect(await savedViewNames(mailbox)).toEqual(['Unread mail']);
      const views = page.getByRole('navigation', { name: 'Saved email views' });

      await mailbox.open();
      await views
        .getByRole('button', { name: /^Unread mail/ })
        .first()
        .click();
      await expect(page).toHaveURL(/savedView=/);
      await expect.poll(() => rowIds(page)).toEqual([alpha.id]);
      await page.getByRole('button', { name: 'Saved view actions' }).click();
      did('AL-707', 'F-048');
      await page.getByRole('menuitem', { name: 'Delete view' }).click();
      const confirmation = page
        .getByRole('alertdialog')
        .or(page.getByRole('dialog'));
      await expect(
        confirmation.getByText('Delete “Unread mail”?')
      ).toBeVisible();
      saw('STL-066');
      await confirmation.getByRole('button', { name: 'Delete view' }).click();
      did('AL-113');

      await expect(
        views.getByRole('button', { name: /Unread mail/ })
      ).toHaveCount(0);
      await expect(page).not.toHaveURL(/savedView=/);
      await expect(
        page
          .getByRole('radiogroup', { name: 'Inbox view' })
          .getByRole('radio', { name: 'Signal' })
      ).toBeChecked();
      await expect.poll(() => rowIds(page)).toEqual([alpha.id]);
      saw('STL-710');
      await expect.poll(() => savedViewNames(mailbox)).toEqual([]);
      confirmed('F-048');
    });

    // When this fails, next and previous from an open thread do nothing or
    // open a thread that is not the list's neighbour.
    test('j and k step from an open thread to the next and back', async ({
      page,
      mailbox,
    }) => {
      const subjects = ['Alpha', 'Bravo', 'Charlie'];
      for (const subject of subjects) {
        await mailbox.deliver({ from, subject, text: `Body of ${subject}.` });
      }
      const subjectOf = new Map<string, string>();
      for (const subject of subjects) {
        subjectOf.set((await mailbox.synced(subject)).id, subject);
      }
      const shown = (threadId: string) =>
        page.getByRole('heading', { name: subjectOf.get(threadId), level: 1 });

      await mailbox.open();
      await expect.poll(async () => (await rowIds(page)).length).toBe(3);
      const rows = await rowIds(page);
      await row(page, rows[0]).click();
      did('AL-050');
      await expect.poll(() => openThreadId(page)).toBe(rows[0]);
      await expect(shown(rows[0])).toBeVisible();
      await page.keyboard.press('j');
      did('AL-124');
      await expect.poll(() => openThreadId(page)).toBe(rows[1]);
      await expect(shown(rows[1])).toBeVisible();
      await expect(
        page.getByText(`Body of ${subjectOf.get(rows[1])}.`)
      ).toBeVisible();
      saw('STL-952');
      await page.keyboard.press('k');
      await expect.poll(() => openThreadId(page)).toBe(rows[0]);
      await expect(shown(rows[0])).toBeVisible();
      await expect(
        page.getByText(`Body of ${subjectOf.get(rows[0])}.`)
      ).toBeVisible();
      saw('STL-952');
    });

    // When this fails, opening a thread leaves it unread at the provider,
    // or its row keeps the unread mark after it was read.
    //
    // The unread mark is named "Unread" by this change; the test fails at
    // that mark until the served bundle is rebuilt with it.
    test('an opened thread is read at the provider and its row loses the unread mark', async ({
      page,
      mailbox,
    }) => {
      for (const subject of ['Alpha', 'Bravo']) {
        await mailbox.deliver({ from, subject, text: `Body of ${subject}.` });
      }
      const alpha = await mailbox.synced('Alpha');
      const bravo = await mailbox.synced('Bravo');
      const unreadMark = (threadId: string) =>
        row(page, threadId).getByRole('img', { name: 'Unread' });

      await mailbox.open();
      await expect(unreadMark(alpha.id)).toHaveCount(1);
      await expect(unreadMark(bravo.id)).toHaveCount(1);
      await row(page, alpha.id).click();
      did('AL-050');
      did('AL-194');
      await expect(page.getByText('Body of Alpha.')).toBeVisible();
      await expect
        .poll(async () =>
          (await mailbox.providerMessages())
            .filter((message) => message.read)
            .map((message) => message.subject)
        )
        .toEqual(['Alpha']);
      confirmed('F-070');
      await page.keyboard.press('Escape');
      did('AL-123');
      await expect(row(page, bravo.id)).toBeVisible();
      saw('STL-966');
      await expect(unreadMark(alpha.id)).toHaveCount(0);
      await expect(unreadMark(bravo.id)).toHaveCount(1);
      saw('STL-929');
    });

    // When this fails, a thread moved to a folder is not filed there at the
    // service, its row does not name the folder, or the folder's name on the
    // row does not open the folder.
    test('a thread moved to a folder names it on its row, and the name opens the folder', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({
        from,
        subject: 'Contract draft',
        text: 'The contract is attached.',
      });
      await mailbox.deliver({
        from,
        subject: 'Lunch on Friday',
        text: 'Are you free?',
      });
      const contract = await mailbox.synced('Contract draft');
      await mailbox.synced('Lunch on Friday');
      const projectOf = async () => {
        const response = await mailbox.api(
          `/email/email/threads/${contract.id}?limit=1`
        );
        const body = (await response.json()) as {
          thread?: { project_id?: string | null };
        };
        return body.thread?.project_id ?? undefined;
      };
      expect(await projectOf()).toBeUndefined();

      await mailbox.open();
      await focusRow(page, contract.id);
      await page.keyboard.press('m');
      await page
        .getByRole('combobox', { name: /Search folders/ })
        .fill('Clients 2026');
      await page.keyboard.press('Enter');
      did('AL-197');
      await expect(notice(page, 'Moved to folder')).toBeVisible();
      saw('STL-113');
      await expect.poll(projectOf).toBeDefined();
      const projects = (await (await mailbox.api('/dss/projects')).json()) as {
        data: { id: string; name: string }[];
      };
      expect(projects.data.map(({ id, name }) => ({ id, name }))).toEqual([
        { id: await projectOf(), name: 'Clients 2026' },
      ]);
      confirmed('F-087');

      await row(page, contract.id)
        .getByRole('button', { name: 'Clients 2026' })
        .click();
      did('AL-408');
      await expect(page).toHaveURL(
        new RegExp(`/app/project/${projects.data[0].id}`)
      );
      await expect(page.getByText('Clients 2026').first()).toBeVisible();
      saw('STL-947');
      await expect(page.getByText('Contract draft')).toBeVisible();
      await expect(page.getByText('Lunch on Friday')).toHaveCount(0);
      saw('STL-968');
    });
  });
}
