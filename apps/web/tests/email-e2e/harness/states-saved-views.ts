// What the tests of the saved views' own states share: a gate on one of the
// storage service's saved-view requests (held, refused or let through), and
// a second inbox with a send-as alias.

import type { Page, Route } from '@playwright/test';
import { expect, type Mailbox } from './fixtures';
import type { LinkedInbox } from './stack';
import { closeMenus, filterSubmenu, openFilterGroup } from './ways-list1';

/** The second inbox some tests link, and its send-as alias. */
export const WORK = 'work@example.com';
export const ALIAS = 'sales@example.com';

const GRAPHQL = /\/graphql(\?|$)/;

/** How a refused request is answered. */
export type Refusal = { status: number; contentType?: string; body: string };

/** The service is down: the request fails without a message. */
export const SERVER_DOWN: Refusal = { status: 500, body: '{}' };

/** The service answers the request with an error of its own. */
export function refusal(
  message: string,
  code = 'INTERNAL_SERVER_ERROR'
): Refusal {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      data: null,
      errors: [{ message, extensions: { code } }],
    }),
  };
}

type Sent = { operationName?: string; variables?: Record<string, unknown> };

/**
 * One GraphQL operation of the storage service, between the app and the
 * service: its requests pass, wait until let go, or are refused, as the test
 * says. Requests of other operations are left alone.
 */
export class OperationGate {
  private mode: 'pass' | 'hold' | 'refuse' = 'pass';
  private answer: Refusal = SERVER_DOWN;
  private waiting: (() => void)[] = [];
  private count = 0;
  private readonly operation: string;
  private readonly matches: (variables: Record<string, unknown>) => boolean;

  private constructor(
    operation: string,
    matches: (variables: Record<string, unknown>) => boolean
  ) {
    this.operation = operation;
    this.matches = matches;
  }

  /** A gate on the requests of `operation` whose variables match. */
  static async on(
    page: Page,
    operation: string,
    matches: (variables: Record<string, unknown>) => boolean = () => true
  ): Promise<OperationGate> {
    const gate = new OperationGate(operation, matches);
    await page.route(GRAPHQL, (route) => gate.handle(route));
    return gate;
  }

  /** The requests of the operation the app has sent so far. */
  get sent(): number {
    return this.count;
  }

  /** The requests waiting at the gate now. */
  get held(): number {
    return this.waiting.length;
  }

  /** Holds the requests from now on, until `pass` or `refuse`. */
  hold(): void {
    this.mode = 'hold';
  }

  /** Lets the held requests and the next ones through to the service. */
  pass(): void {
    this.mode = 'pass';
    this.letGo();
  }

  /** Answers the held requests and the next ones with `answer`. */
  refuse(answer: Refusal = SERVER_DOWN): void {
    this.mode = 'refuse';
    this.answer = answer;
    this.letGo();
  }

  private letGo(): void {
    const waiting = this.waiting;
    this.waiting = [];
    for (const go of waiting) go();
  }

  private async handle(route: Route): Promise<void> {
    if (!this.mine(route)) return passOn(route);
    this.count += 1;
    if (this.mode === 'hold')
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    if (this.mode === 'refuse')
      return route.fulfill(this.answer).catch(() => {});
    return passOn(route);
  }

  private mine(route: Route): boolean {
    let sent: Sent = {};
    try {
      sent = JSON.parse(route.request().postData() ?? '{}') as Sent;
    } catch {
      return false;
    }
    return (
      sent.operationName === this.operation &&
      this.matches(sent.variables ?? {})
    );
  }
}

/**
 * Lets a request go on to the next handler; one the page dropped meanwhile
 * (a reload, the test's end) is gone and left alone.
 */
function passOn(route: Route): Promise<void> {
  return route.fallback().catch(() => {});
}

/**
 * Links a second Gmail inbox whose account has a send-as alias, made in the
 * emulator with its alias first, as `ways-list1-inboxes.spec.ts` does, and
 * gives that inbox.
 */
export async function linkAliasInbox(mailbox: Mailbox): Promise<LinkedInbox> {
  const created = await fetch(
    `${mailbox.stack.info.gmailUrl}/_emulator/mailboxes`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: WORK, send_as: [{ email: ALIAS }] }),
    }
  );
  expect(created.ok).toBe(true);
  return mailbox.stack.link(mailbox.user, 'GMAIL', WORK);
}

/** Narrows the list to the mail of the alias, from the sidebar's account menu. */
export async function chooseAlias(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Select inbox: All inboxes' }).click();
  await page
    .getByRole('menu')
    .getByRole('menuitemradio')
    .filter({ hasText: 'Alias' })
    .filter({ hasText: ALIAS })
    .click();
  await expect(
    page.getByRole('button', { name: `Select inbox: ${ALIAS}` })
  ).toBeVisible();
}

/**
 * Adds a domain to the list's People filter: the domain's own suggestion,
 * which stays once the suggestions arrive (the typed "Add" entry does not).
 */
export async function addPeopleDomain(
  page: Page,
  domain: string
): Promise<void> {
  await openFilterGroup(page, 'People');
  const people = filterSubmenu(page, 'People');
  await people.getByRole('combobox').fill(domain);
  await people
    .getByRole('option', {
      name: new RegExp(`^${domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} `),
    })
    .click();
  await closeMenus(page);
}

/** Edits the open view through the list's Filters menu: read mail only. */
export async function onlyReadMail(page: Page): Promise<void> {
  await closeMenus(page);
  await openFilterGroup(page, 'Read status');
  await filterSubmenu(page, 'Read status')
    .getByRole('menuitemradio', { name: 'Read', exact: true })
    .click();
  await closeMenus(page);
}
