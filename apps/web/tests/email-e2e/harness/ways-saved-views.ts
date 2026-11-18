// Saved email views as the storage service holds them, and the places the
// app lists them: what the tests of the other ways into saved views share.

import type { Locator, Page } from '@playwright/test';
import { expect, type Mailbox } from './fixtures';

/** The conditions of an email view, as its stored definition spells them. */
export type ViewFilters = {
  done?: string;
  read?: string;
  tags: { optionId: string; propertyDefinitionId: string }[];
  starred: boolean;
  subject: string[];
  inboxIds: string[];
  importance?: string;
  attachments: string[];
  participants: unknown[];
  calendarInvite: boolean;
  participantFields: string[];
  receivedWithinDays?: number;
};

/** A view that restricts nothing. */
export const NO_FILTERS: ViewFilters = {
  tags: [],
  starred: false,
  subject: [],
  inboxIds: [],
  attachments: [],
  participants: [],
  calendarInvite: false,
  participantFields: ['from', 'to', 'cc'],
};

export type StoredView = {
  id: string;
  name: string;
  revision: number;
  filters: Partial<ViewFilters>;
};

/** Asks the storage service's GraphQL as the signed-in user. */
export async function graphql<T>(
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
export async function storedViews(mailbox: Mailbox): Promise<StoredView[]> {
  const views: StoredView[] = [];
  let after: string | null = null;
  do {
    const data: {
      user: {
        savedViews: {
          nodes: {
            id: string;
            name: string;
            revision: number;
            config: { filters: Partial<ViewFilters> };
          }[];
          nextCursor: string | null;
        };
      };
    } = await graphql(
      mailbox,
      'query ($after: String) { user { id savedViews(first: 50, after: $after) { nodes { id name revision config } nextCursor } } }',
      { after }
    );
    for (const view of data.user.savedViews.nodes) {
      views.push({
        id: view.id,
        name: view.name,
        revision: view.revision,
        filters: view.config.filters,
      });
    }
    after = data.user.savedViews.nextCursor;
  } while (after);
  return views;
}

/** The names of the stored views, in their order. */
export async function storedNames(mailbox: Mailbox): Promise<string[]> {
  return (await storedViews(mailbox)).map((view) => view.name);
}

/** The stored view of a name; `undefined` when the service holds none. */
export async function storedView(
  mailbox: Mailbox,
  name: string
): Promise<StoredView | undefined> {
  return (await storedViews(mailbox)).find((view) => view.name === name);
}

/** Stores a saved view without the app, and answers its id. */
export async function storeView(
  mailbox: Mailbox,
  name: string,
  filters: Partial<ViewFilters>
): Promise<string> {
  const id = crypto.randomUUID();
  await graphql(
    mailbox,
    'mutation ($input: CreateSavedViewInput!) { createSavedView(input: $input) { id } }',
    {
      input: {
        id,
        name,
        config: {
          kind: 'email',
          version: 1,
          filters: { ...NO_FILTERS, ...filters },
        },
      },
    }
  );
  return id;
}

/**
 * Changes a stored view without the app, as another device would: the view
 * the app has open is then a revision behind.
 */
export async function changeStoredView(
  mailbox: Mailbox,
  name: string,
  filters: Partial<ViewFilters>
): Promise<void> {
  const view = await storedView(mailbox, name);
  if (!view) throw new Error(`the service holds no view named ${name}`);
  await graphql(
    mailbox,
    'mutation ($input: UpdateSavedViewInput!) { updateSavedView(input: $input) { id } }',
    {
      input: {
        id: view.id,
        name,
        config: {
          kind: 'email',
          version: 1,
          filters: { ...NO_FILTERS, ...filters },
        },
        expectedRevision: view.revision,
      },
    }
  );
}

/** The saved views of the Email sidebar, or of its sheet on touch. */
export function viewList(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Saved email views' });
}

/** The row of a saved view in that list, whether or not it has unread mail. */
export function viewRow(page: Page, name: string): Locator {
  return viewList(page)
    .getByRole('button', { name })
    .filter({
      hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
    });
}

/** The names of the listed saved views, top to bottom. */
export function listedNames(page: Page): Promise<string[]> {
  return viewList(page)
    .getByRole('button')
    .evaluateAll((buttons) =>
      buttons
        .filter((button) => !button.hasAttribute('aria-haspopup'))
        .map((button) => button.textContent?.trim() ?? '')
    );
}

/**
 * Closes the menus open over the list, one Escape at a time and none once
 * they are gone: Escape on the list itself leaves an open saved view.
 */
export async function closeMenus(page: Page): Promise<void> {
  const menus = page.getByRole('menu');
  for (;;) {
    const open = await menus.count();
    if (open === 0) return;
    await page.keyboard.press('Escape');
    await expect.poll(() => menus.count()).toBeLessThan(open);
  }
}
