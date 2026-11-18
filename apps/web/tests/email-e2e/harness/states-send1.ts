// What the send states tests (`states-send1-*.spec.ts`) share: requests
// held or refused on their way to the services, reads and writes of the
// drafts kept on this device held or failed, and the delivery state Macro
// holds for a send, set the way the service leaves it.

import type { Page, Request, Route } from '@playwright/test';
import { graphqlOperation } from './drafts';
import type { Mailbox } from './fixtures';

/** Requests caught on their way out, answered when the test says so. */
export type Held = {
  /** Resolves with the first request caught. */
  arrived: Promise<Request>;
  /** How many were caught. */
  count: () => number;
  /** Lets every caught request, and every later one, go to the service. */
  release: () => Promise<void>;
};

/**
 * Holds every request `matches` picks until `release`: the app shows what it
 * shows while one is in flight, for as long as the test looks.
 */
export async function hold(
  page: Page,
  matches: (request: Request) => boolean
): Promise<Held> {
  const routes: Route[] = [];
  let released = false;
  let arrive: (request: Request) => void = () => {};
  const arrived = new Promise<Request>((resolve) => {
    arrive = resolve;
  });
  await page.route('**/*', async (route) => {
    if (released || !matches(route.request())) return route.fallback();
    routes.push(route);
    arrive(route.request());
  });
  return {
    arrived,
    count: () => routes.length,
    release: async () => {
      released = true;
      // A request the page gave up on meanwhile cannot be answered.
      await Promise.all(
        routes.map((route) => route.fallback().catch(() => {}))
      );
    },
  };
}

/** What the page's use of the drafts it keeps on this device does. */
export type DraftStorage = {
  /** Holds every read that starts while a composer says it is loading its draft. */
  holdReads: () => Promise<void>;
  /** Fails every read, as a browser whose storage broke underneath fails it. */
  failReads: () => Promise<void>;
  /** Fails every write, as a browser whose storage broke underneath fails it. */
  failWrites: () => Promise<void>;
  /** Lets reads and writes run again; the held ones finish. */
  release: () => Promise<void>;
};

type DraftStorageMode = 'hold-reads' | 'fail-reads' | 'fail-writes';

const DRAFT_STORAGE = 'emailE2eDraftStorage';

/**
 * Lets the test hold or fail the page's reads and writes of its working
 * copies of drafts (the browser database a composer saves a draft to and
 * reads it back from), for this tab and across its reloads. Call it before
 * the first navigation.
 */
export async function draftStorage(page: Page): Promise<DraftStorage> {
  await page.addInitScript((key) => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (
      this: IDBDatabase,
      ...args: Parameters<IDBDatabase['transaction']>
    ) {
      const mode =
        this.name === 'macro-email-working-copies-v1'
          ? sessionStorage.getItem(key)
          : null;
      const writing = args[1] === 'readwrite';
      if (mode === (writing ? 'fail-writes' : 'fail-reads'))
        throw new DOMException('refused by the test', 'UnknownError');
      const tx = original.apply(this, args);
      if (
        mode === 'hold-reads' &&
        !writing &&
        document.body.innerText.includes('Loading draft…')
      ) {
        // A transaction stays open, its result unsettled, while it has
        // requests to answer.
        const drafts = tx.objectStore('drafts');
        const wait = () => {
          drafts.count().onsuccess = () => {
            if (sessionStorage.getItem(key) === 'hold-reads') wait();
          };
        };
        wait();
      }
      return tx;
    };
  }, DRAFT_STORAGE);
  const set = (mode: DraftStorageMode | null) =>
    page.evaluate(
      ([key, value]) => {
        if (value) sessionStorage.setItem(key, value);
        else sessionStorage.removeItem(key);
      },
      [DRAFT_STORAGE, mode] as const
    );
  return {
    holdReads: () => set('hold-reads'),
    failReads: () => set('fail-reads'),
    failWrites: () => set('fail-writes'),
    release: () => set(null),
  };
}

/** The GraphQL operation `name`, as the page sends it. */
export function operation(name: string): (request: Request) => boolean {
  return (request) => graphqlOperation(request) === name;
}

/**
 * A write that takes threads out of the inbox (`archived` true, Mark done) or
 * puts them back (`archived` false).
 */
export function archiveRequest(
  archived: boolean
): (request: Request) => boolean {
  return (request) => {
    const name = graphqlOperation(request);
    if (name !== 'SetEmailThreadArchived' && name !== 'SetEmailThreadsArchived')
      return false;
    const body = request.postDataJSON() as {
      variables?: { input?: { archived?: boolean } };
    };
    return body.variables?.input?.archived === archived;
  };
}

/**
 * A request to the email service's scheduled-send endpoint for one message:
 * `PUT` schedules it or moves its time, `DELETE` takes the time away.
 */
export function scheduleRequest(
  method: 'PUT' | 'DELETE'
): (request: Request) => boolean {
  return (request) =>
    request.method() === method &&
    /\/email\/drafts\/scheduled\/[^/?]+$/.test(new URL(request.url()).pathname);
}

/**
 * Refuses the next `times` requests `matches` picks, the way the service
 * refuses them: a 500 for REST, a GraphQL error naming the operation
 * otherwise. Returns how many it refused so far.
 */
export async function refuse(
  page: Page,
  matches: (request: Request) => boolean,
  times = 1
): Promise<() => number> {
  let refused = 0;
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (refused >= times || !matches(request)) return route.fallback();
    refused += 1;
    const name = graphqlOperation(request);
    if (!name) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'refused by the test' }),
      });
      return;
    }
    const field = name.charAt(0).toLowerCase() + name.slice(1);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: null,
        errors: [
          {
            message: 'refused by the test',
            path: [field],
            extensions: { code: 'INTERNAL' },
          },
        ],
      }),
    });
  });
  return () => refused;
}

/**
 * Sets the inbox's one open send attempt as unconfirmed, as the service
 * leaves a send whose outcome it could not learn.
 */
export async function leaveSendUnconfirmed(mailbox: Mailbox): Promise<void> {
  const rows = await mailbox.stack.sql(
    `UPDATE email_send_attempts SET delivery_unconfirmed = true
     WHERE link_id = '${mailbox.inbox.linkId}' AND NOT cancelled AND NOT sent
     RETURNING attempt_id`
  );
  if (rows.length !== 1)
    throw new Error(`${rows.length} open send attempts, not one`);
}

/**
 * Sets a scheduled message's delivery as a sweep leaves it: `sending` once
 * it has claimed the message and started, `unconfirmed` when it could not
 * learn whether the provider took it.
 */
export async function setScheduledDelivery(
  mailbox: Mailbox,
  messageId: string,
  state: 'sending' | 'unconfirmed'
): Promise<void> {
  const rows = await mailbox.stack.sql(
    `UPDATE email_scheduled_messages SET delivery_status = '${
      state === 'sending' ? 'ready' : 'unconfirmed'
    }', processing = true, delivery_claim_id = gen_random_uuid(),
       delivery_started_at = now()
     WHERE message_id = '${messageId}' AND link_id = '${mailbox.inbox.linkId}'
     RETURNING message_id`
  );
  if (rows.length !== 1)
    throw new Error(`no scheduled message ${messageId} to change`);
}
