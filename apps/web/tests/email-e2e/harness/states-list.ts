// What the tests of the list's states share: the tabs a user moves between,
// the empty state each one shows, mail put in Trash at the provider, Focus
// threads with a reason, a due date and a trend, and requests the page sends
// held back or made to fail.

import { expect, type Locator, type Page, type Route } from '@playwright/test';
import { graphqlOperation } from './drafts';
import type { Mailbox } from './fixtures';
import type { Mail } from './stack';
import { changeAtProvider } from './sync';

/** Opens a tab of the desktop Inbox header: Focus, Signal or Noise. */
export async function inboxTab(page: Page, name: string): Promise<void> {
  const tabs = page.getByRole('radiogroup', { name: 'Inbox view' });
  await tabs.getByText(name, { exact: true }).click();
  await expect(tabs.getByRole('radio', { name })).toBeChecked();
}

/** Opens a tab of the desktop sidebar, under Inbox or in the Library. */
export async function sidebarTab(page: Page, name: string): Promise<void> {
  const library = ['All mail', 'Archived', 'Shared', 'Spam', 'Trash'];
  await page
    .getByRole('navigation', {
      name: library.includes(name) ? 'Email library' : 'Email tabs',
    })
    .getByRole('button', { name, exact: true })
    .click();
}

/** The title of the empty state the list shows in its place. */
export function emptyTitle(page: Page, title: string): Locator {
  return page.getByRole('heading', { name: title, exact: true });
}

/** A button of the selection toolbar: the rows have one of the same name. */
export function toolbarButton(page: Page, name: string): Locator {
  return page
    .getByRole('button', { name, exact: true })
    .and(page.locator(':not([data-entity-id] *)'));
}

/** Puts a message in the inbox's trash at the provider, and announces it. */
export async function deliverToTrash(
  mailbox: Mailbox,
  mail: Mail
): Promise<void> {
  const delivered = await mailbox.deliver(mail);
  await changeAtProvider(mailbox, delivered.id, { trashed: true });
}

/** What the worker that reads mail for Focus decided about a thread. */
export type FocusSeed = {
  /** What the owner owes: a reply, or a follow up on their own message. */
  flag?: 'reply' | 'follow-up';
  /** What the mail is, as stored (`FocusCategory`, snake case). */
  category?: 'customer' | 'team' | 'known' | 'calendar' | 'other';
  /** The day the mail says it is due, as `yyyy-mm-dd`. */
  dueOn?: string;
  /** How fast importance moves while untouched: up above 0, down below. */
  rate?: number;
};

/**
 * Has the thread in Focus as the worker would leave it (no stack runs its
 * model), like `inFocus` in `ways-list-more.ts` with a category, a due day
 * and a trend too.
 */
export async function seedFocus(
  mailbox: Mailbox,
  threadId: string,
  seed: FocusSeed
): Promise<void> {
  const rows = await mailbox.stack.sql(
    `INSERT INTO email_thread_focus (
       thread_id, link_id, classified_message_id, classified_message_ts,
       is_focus, category, importance, needs_reply, needs_follow_up, scores,
       model, classified_at, importance_rate, due_on)
     SELECT t.id, t.link_id, m.id, COALESCE(m.internal_date_ts, m.created_at),
            true, '${seed.category ?? 'other'}', 50,
            ${seed.flag === 'reply'}, ${seed.flag === 'follow-up'},
            '{}'::jsonb, 'email-e2e', now(), ${seed.rate ?? 0},
            ${seed.dueOn ? `'${seed.dueOn}'::date` : 'NULL'}
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

/** Noon of the local day `days` from today. */
export function localDay(days: number): Date {
  const day = new Date();
  day.setHours(12, 0, 0, 0);
  day.setDate(day.getDate() + days);
  return day;
}

/** A local day as the `yyyy-mm-dd` Focus stores. */
export function isoDay(day: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

const GRAPHQL = /\/graphql(\?|$)/;

/**
 * Refuses the GraphQL requests of an operation whose body `matches` for good
 * (a server error would only queue the write for another try) while
 * `refusing()` answers true.
 */
export async function refuseOperation(
  page: Page,
  operation: string,
  matches: (body: string) => boolean = () => true,
  refusing: () => boolean = () => true
): Promise<void> {
  await page.route(GRAPHQL, (route) => {
    const request = route.request();
    if (
      !refusing() ||
      graphqlOperation(request) !== operation ||
      !matches(request.postData() ?? '')
    )
      return route.fallback();
    return route.fulfill({
      json: {
        data: null,
        errors: [{ message: 'refused', extensions: { code: 'INVALID' } }],
      },
    });
  });
}

/** Requests held back by `holdRequests`, to answer once a state was seen. */
export type Held = {
  /** How many are held now. */
  count: () => number;
  /** Lets the held ones and every later one through. */
  release: () => Promise<void>;
  /** Answers the held ones with a server error and stops holding. */
  fail: () => Promise<void>;
};

/** Holds back the requests `select` picks, from now until released. */
export async function holdRequests(
  page: Page,
  url: RegExp,
  select: (route: Route) => boolean
): Promise<Held> {
  const held: Route[] = [];
  let holding = true;
  await page.route(url, (route) => {
    if (!holding || !select(route)) return route.fallback();
    held.push(route);
  });
  return {
    count: () => held.length,
    release: async () => {
      holding = false;
      for (const route of held.splice(0)) await route.fallback();
    },
    fail: async () => {
      holding = false;
      for (const route of held.splice(0))
        await route.fulfill({ status: 500, body: '{}' });
    },
  };
}

/** Holds back the GraphQL requests of an operation whose body `matches`. */
export function holdOperation(
  page: Page,
  operation: string,
  matches: (body: string) => boolean = () => true
): Promise<Held> {
  return holdRequests(
    page,
    GRAPHQL,
    (route) =>
      graphqlOperation(route.request()) === operation &&
      matches(route.request().postData() ?? '')
  );
}
