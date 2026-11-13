// What the mail list and the thread view show, and what the browser asks
// the services, for tests of list and thread state.

import { expect, type Page } from '@playwright/test';
import type { Mailbox } from './fixtures';
import type { Mail } from './stack';

/** A GraphQL operation the browser sent. */
export type SentOperation = { name: string; variables: unknown };

/** Records the GraphQL operations the page sends from now on. */
export function sentOperations(page: Page): SentOperation[] {
  const sent: SentOperation[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'POST') return;
    if (!new URL(request.url()).pathname.endsWith('/graphql')) return;
    try {
      const body = JSON.parse(request.postData() ?? '') as {
        operationName?: string;
        variables?: unknown;
      };
      if (body.operationName) {
        sent.push({ name: body.operationName, variables: body.variables });
      }
    } catch {
      // Not a GraphQL request.
    }
  });
  return sent;
}

/**
 * The archive and unarchive requests in `sent`, as `thread id:archived`.
 * A request for several threads counts once per thread.
 */
export function archiveRequests(sent: SentOperation[]): string[] {
  return sent.flatMap(({ name, variables }) => {
    const input = (variables as { input?: Record<string, unknown> } | undefined)
      ?.input;
    if (name === 'SetEmailThreadsArchived') {
      return ((input?.threadIds ?? []) as string[]).map(
        (id) => `${id}:${input?.archived}`
      );
    }
    if (name === 'SetEmailThreadArchived') {
      return [`${input?.threadId}:${input?.archived}`];
    }
    return [];
  });
}

/** The threads the page asked to mark seen, in order, without repeats. */
export function seenRequests(sent: SentOperation[]): string[] {
  const ids = sent
    .filter(({ name }) => name === 'MarkEmailThreadSeen')
    .map(
      ({ variables }) =>
        (variables as { input: { threadId: string } }).input.threadId
    );
  return [...new Set(ids)];
}

/** The thread ids of the list's rows, top to bottom. */
export function rowIds(page: Page): Promise<string[]> {
  return page
    .locator('[data-soup-entity] [data-entity-id]')
    .evaluateAll((rows) =>
      rows.map((row) => row.getAttribute('data-entity-id') ?? '')
    )
    .catch(() => []); // The app redirects while it starts.
}

/** The thread id of the row the list's cursor is on. */
export async function focusedRowId(page: Page): Promise<string | undefined> {
  const ids = await page
    .locator('[data-soup-entity] [data-entity-id].bg-list-highlighted')
    .evaluateAll((rows) =>
      rows.map((row) => row.getAttribute('data-entity-id') ?? '')
    );
  return ids.length === 1 ? ids[0] : undefined;
}

/** The thread the page has open, from its address. */
export function openThreadId(page: Page): string | undefined {
  return /\/app\/mail\/([0-9a-f-]{36})/.exec(new URL(page.url()).pathname)?.[1];
}

/**
 * Puts a message with these Gmail labels in the mailbox and has Gmail
 * announce it: `CATEGORY_PROMOTIONS` is how mail lands in Noise.
 */
export async function deliverLabelled(
  mailbox: Mailbox,
  mail: Mail,
  labels: string[]
): Promise<void> {
  const base = `${mailbox.stack.info.gmailUrl}/_emulator/mailboxes/${encodeURIComponent(
    mailbox.inbox.email
  )}`;
  const delivered = await fetch(`${base}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      from: mail.from,
      subject: mail.subject,
      text: mail.text,
      labels,
    }),
  });
  if (!delivered.ok)
    throw new Error(`Gmail refused the message: ${delivered.status}`);
  const pushed = await fetch(`${base}/push`, { method: 'POST' });
  if (!pushed.ok)
    throw new Error(`Gmail did not announce it: ${pushed.status}`);
}

/**
 * Whether the app's startup catch-up of the list has finished. Until then a
 * row can arrive with a catch-up page instead of the live update under test.
 */
export function catchUpFinished(page: Page): Promise<boolean> {
  return page
    .evaluate(() => {
      const lanes = Object.keys(localStorage).filter((key) =>
        key.startsWith('graphql-soup-backfill:')
      );
      return (
        lanes.length >= 9 &&
        lanes.every(
          (key) =>
            JSON.parse(localStorage.getItem(key) ?? '{}').completed === true
        )
      );
    })
    .catch(() => false);
}

/**
 * Subscribes to the list's live updates on a socket of its own, beside the
 * app's, and returns how many updates that socket has received so far. The
 * services start publishing updates some seconds after they come up; a test
 * of live updates waits for the first one here before it acts.
 */
export async function liveUpdates(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const counter = { count: 0 };
    (window as unknown as { liveUpdates: typeof counter }).liveUpdates =
      counter;
    const url = new URL('/dss/items/soup/graphql/ws', location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url, 'graphql-transport-ws');
    socket.onopen = () =>
      socket.send(JSON.stringify({ type: 'connection_init', payload: {} }));
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as { type: string };
      if (message.type === 'connection_ack') {
        socket.send(
          JSON.stringify({
            id: 'live-updates',
            type: 'subscribe',
            payload: {
              query: 'subscription { soupUpdates { __typename } }',
            },
          })
        );
      }
      if (message.type === 'ping')
        socket.send(JSON.stringify({ type: 'pong' }));
      if (message.type === 'next') counter.count += 1;
    };
  });
  return () =>
    page.evaluate(
      () =>
        (window as unknown as { liveUpdates: { count: number } }).liveUpdates
          .count
    );
}

/**
 * Counts the page's mark-read requests that are still on their way. A test
 * that is about to change a thread's read state waits for none, so a request
 * from the step before cannot land after its own.
 */
export function seenRequestsInFlight(page: Page): () => number {
  const inFlight = new Set<unknown>();
  page.on('request', (request) => {
    if (request.method() !== 'POST') return;
    if (request.postData()?.includes('"MarkEmailThreadSeen"')) {
      inFlight.add(request);
    }
  });
  page.on('requestfinished', (request) => inFlight.delete(request));
  page.on('requestfailed', (request) => inFlight.delete(request));
  return () => inFlight.size;
}

/** Moves the list's cursor to the row of `threadId`, with j and k. */
export async function focusRow(page: Page, threadId: string): Promise<void> {
  await expect.poll(() => rowIds(page)).toContain(threadId);
  await expect.poll(() => focusedRowId(page)).toBeDefined();
  const rows = await rowIds(page);
  const from = rows.indexOf((await focusedRowId(page)) ?? '');
  const to = rows.indexOf(threadId);
  for (let step = 0; step < Math.abs(to - from); step++) {
    await page.keyboard.press(to > from ? 'j' : 'k');
  }
  await expect.poll(() => focusedRowId(page)).toBe(threadId);
}
