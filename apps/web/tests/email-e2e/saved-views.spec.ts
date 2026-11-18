// Saved views of the mail list: one is made in the builder and opens the
// mail it names, one is edited, renamed and duplicated, and two change
// places in the sidebar. Each for a Gmail and an Outlook inbox.

import type { Locator, Page } from '@playwright/test';
import { loadAppSteadily } from './harness/drafts';
import { expect, type Mailbox, test } from './harness/fixtures';
import { rowIds } from './harness/list';
import { anInbox, PROVIDERS } from './harness/providers';
import { confirmed, did, saw } from './ledger/record';

const from = 'Grace <grace@example.com>';

type StoredView = {
  name: string;
  config: { filters: { subject: string[] } };
};

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

/** The user's saved views, in their order, as the service holds them. */
async function storedViews(
  mailbox: Mailbox
): Promise<{ name: string; subject: string[] }[]> {
  const data = await graphql<{
    user: { savedViews: { nodes: StoredView[] } };
  }>(
    mailbox,
    'query { user { id savedViews(first: 20) { nodes { name config } } } }'
  );
  return data.user.savedViews.nodes.map((view) => ({
    name: view.name,
    subject: view.config.filters.subject,
  }));
}

/** Stores a saved view of the mail whose subject holds a word. */
async function storeView(
  mailbox: Mailbox,
  name: string,
  subject: string
): Promise<void> {
  await graphql(
    mailbox,
    'mutation ($input: CreateSavedViewInput!) { createSavedView(input: $input) { id } }',
    {
      input: {
        id: crypto.randomUUID(),
        name,
        config: {
          kind: 'email',
          version: 1,
          filters: {
            done: 'any',
            read: 'any',
            tags: [],
            starred: false,
            subject: [subject],
            inboxIds: [],
            importance: 'any',
            attachments: [],
            participants: [],
            calendarInvite: false,
            participantFields: ['from', 'to', 'cc'],
          },
        },
      },
    }
  );
}

/** The saved views of the sidebar. */
function sidebarViews(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Saved email views' });
}

/** The names of the sidebar's saved views, top to bottom. */
function sidebarNames(page: Page): Promise<string[]> {
  return sidebarViews(page)
    .getByRole('button', { name: /^\w+ view$/ })
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute('aria-label') ?? '')
    );
}

/** The sidebar row of a saved view, whether or not it has unread mail. */
function viewRow(page: Page, name: string): Locator {
  return sidebarViews(page)
    .getByRole('button', { name })
    .filter({ hasText: new RegExp(`^${name.replace(/[()]/g, '\\$&')}$`) });
}

for (const provider of PROVIDERS) {
  test.describe(`saved views of ${anInbox(provider)}`, () => {
    test.use({ provider });
    test.beforeEach(({ page }) => loadAppSteadily(page));

    // When this fails, the builder saves no view, saves one without its
    // filters, or the saved view does not open the mail it names.
    test('a view made in the builder is saved and opens the mail it names', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({ from, subject: 'Alpha', text: 'Body of Alpha.' });
      await mailbox.deliver({ from, subject: 'Beta', text: 'Body of Beta.' });
      const alpha = await mailbox.synced('Alpha');
      const beta = await mailbox.synced('Beta');
      const builder = page.getByRole('dialog', { name: 'Save view' });

      await mailbox.open();
      await expect.poll(() => rowIds(page)).toEqual([beta.id, alpha.id]);
      await page.getByRole('button', { name: 'New saved view' }).click();
      did('AL-106');
      await expect(builder.getByRole('textbox', { name: 'Name' })).toHaveValue(
        'New view'
      );
      saw('STL-705', 'F-045');
      await builder.getByRole('textbox', { name: 'Name' }).fill('Alpha mail');
      await builder
        .getByRole('textbox', { name: 'Subject contains' })
        .fill('Alpha');
      did('AL-109', 'F-045');
      await builder.getByRole('button', { name: 'Save view' }).click();
      did('AL-110', 'F-045');

      // The new view opens: its row is the selected one, and the list holds
      // the mail it names and nothing else.
      await expect(builder).toHaveCount(0);
      await expect(viewRow(page, 'Alpha mail')).toHaveAttribute(
        'aria-current',
        'page'
      );
      await expect(page).toHaveURL(/savedView=/);
      await expect.poll(() => rowIds(page)).toEqual([alpha.id]);
      await expect
        .poll(() => storedViews(mailbox))
        .toEqual([{ name: 'Alpha mail', subject: ['Alpha'] }]);
      confirmed('F-045');
    });

    // When this fails, a saved view's row opens nothing, opens the whole
    // inbox under the view's name, or does not show which view is open.
    test('a saved view opens from the sidebar with the mail it names', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({ from, subject: 'Alpha', text: 'Body of Alpha.' });
      await mailbox.deliver({ from, subject: 'Beta', text: 'Body of Beta.' });
      const alpha = await mailbox.synced('Alpha');
      const beta = await mailbox.synced('Beta');
      await storeView(mailbox, 'Alpha mail', 'Alpha');

      await mailbox.open();
      await expect.poll(() => rowIds(page)).toEqual([beta.id, alpha.id]);
      // Its mail is unread, which the row says.
      await expect(
        sidebarViews(page).getByRole('button', {
          name: 'Alpha mail, unread mail',
        })
      ).toBeVisible();
      saw('STL-058');
      await viewRow(page, 'Alpha mail').click();
      did('AL-105');
      await expect(viewRow(page, 'Alpha mail')).toHaveAttribute(
        'aria-current',
        'page'
      );
      saw('STL-701');
      await expect(page).toHaveURL(/savedView=/);
      await expect.poll(() => rowIds(page)).toEqual([alpha.id]);
      saw('STL-065');
      await expect(
        page.getByRole('button', { name: 'Saved view actions' })
      ).toBeVisible();
      await expect(
        page.getByRole('radiogroup', { name: 'Inbox view' })
      ).toHaveCount(0);
      saw('STL-712');
    });

    // When this fails, Edit does not change a saved view's name or filters,
    // or Duplicate makes no second view, in the sidebar or at the service.
    test('a saved view is renamed, given other filters, and duplicated', async ({
      page,
      mailbox,
    }) => {
      await mailbox.deliver({ from, subject: 'Alpha', text: 'Body of Alpha.' });
      await mailbox.deliver({ from, subject: 'Beta', text: 'Body of Beta.' });
      const alpha = await mailbox.synced('Alpha');
      const beta = await mailbox.synced('Beta');
      await storeView(mailbox, 'Alpha mail', 'Alpha');
      const editor = page.getByRole('dialog', { name: 'Edit “Alpha mail”' });
      const copier = page.getByRole('dialog', { name: 'Duplicate saved view' });

      await mailbox.open();
      await viewRow(page, 'Alpha mail').click();
      await expect.poll(() => rowIds(page)).toEqual([alpha.id]);
      await page
        .getByRole('button', { name: 'Actions for Alpha mail' })
        .click();
      did('AL-707', 'F-047');
      await page.getByRole('menuitem', { name: 'Edit' }).click();
      did('AL-111');
      await expect(editor.getByRole('textbox', { name: 'Name' })).toHaveValue(
        'Alpha mail'
      );
      saw('STL-705', 'F-047');
      await editor.getByRole('textbox', { name: 'Name' }).fill('Beta mail');
      await editor
        .getByRole('textbox', { name: 'Subject contains' })
        .fill('Beta');
      did('AL-109', 'F-047');
      await editor.getByRole('button', { name: 'Save changes' }).click();
      did('AL-110', 'F-047');

      await expect(editor).toHaveCount(0);
      await expect(viewRow(page, 'Beta mail')).toHaveAttribute(
        'aria-current',
        'page'
      );
      await expect(viewRow(page, 'Alpha mail')).toHaveCount(0);
      await expect.poll(() => rowIds(page)).toEqual([beta.id]);
      await expect
        .poll(() => storedViews(mailbox))
        .toEqual([{ name: 'Beta mail', subject: ['Beta'] }]);

      await page.getByRole('button', { name: 'Actions for Beta mail' }).click();
      await page.getByRole('menuitem', { name: 'Duplicate' }).click();
      did('AL-112');
      await expect(copier.getByRole('textbox', { name: 'Name' })).toHaveValue(
        'Beta mail (copy)'
      );
      await copier.getByRole('button', { name: 'Duplicate' }).click();
      await expect(copier).toHaveCount(0);
      await expect(viewRow(page, 'Beta mail (copy)')).toHaveAttribute(
        'aria-current',
        'page'
      );
      await expect(viewRow(page, 'Beta mail')).toBeVisible();
      await expect.poll(() => rowIds(page)).toEqual([beta.id]);
      const stored = await storedViews(mailbox);
      expect(
        stored.sort((one, other) => one.name.localeCompare(other.name))
      ).toEqual([
        { name: 'Beta mail', subject: ['Beta'] },
        { name: 'Beta mail (copy)', subject: ['Beta'] },
      ]);
      confirmed('F-047');
    });

    // When this fails, dragging a saved view past another leaves the sidebar
    // in its old order, or the order is not kept by the service.
    test('a saved view dragged above another keeps its new place', async ({
      page,
      mailbox,
    }) => {
      await storeView(mailbox, 'First view', 'Alpha');
      await storeView(mailbox, 'Second view', 'Beta');
      const before = (await storedViews(mailbox)).map((view) => view.name);
      expect([...before].sort()).toEqual(['First view', 'Second view']);
      const [upper, lower] = before;

      await mailbox.open();
      await expect.poll(() => sidebarNames(page)).toEqual([upper, lower]);
      await viewRow(page, lower).scrollIntoViewIfNeeded();
      const moved = await viewRow(page, lower).boundingBox();
      const target = await viewRow(page, upper).boundingBox();
      if (!moved || !target) throw new Error('the saved views are not shown');
      await page.mouse.move(
        moved.x + moved.width / 3,
        moved.y + moved.height / 2
      );
      await page.mouse.down();
      await page.mouse.move(target.x + target.width / 3, target.y + 2, {
        steps: 12,
      });
      await page.mouse.up();
      did('AL-114');

      await expect.poll(() => sidebarNames(page)).toEqual([lower, upper]);
      saw('STL-702');
      await expect
        .poll(async () => (await storedViews(mailbox)).map((view) => view.name))
        .toEqual([lower, upper]);
      confirmed('F-049');
    });
  });
}
