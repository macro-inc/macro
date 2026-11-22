// What the `states-settings-*` specs share: a section of a settings page,
// requests held until the test lets them through or fails them, provider
// faults the test takes back, and an inbox someone else connected and
// shared with the signed-in user.

import {
  expect,
  type Locator,
  type Page,
  type WebSocketRoute,
} from '@playwright/test';
import type { Mailbox } from './fixtures';
import { emulatorUrl } from './journeys';
import { MAIL_SCOPE } from './ways-settings-more';

/**
 * A section of a settings page, found by its heading ("Accounts"): the
 * nearest section around it, since the page's own section holds them all.
 */
export function settingsSection(page: Page, title: string): Locator {
  return page
    .getByRole('heading', { name: title, level: 2, exact: true })
    .locator('xpath=ancestor::section[1]');
}

/** Requests the app makes, held until the test says what becomes of them. */
export type Hold = {
  /** How many requests reached the hold so far. */
  seen(): number;
  /** Lets the held requests, and every later one, reach the service. */
  release(): void;
  /** Answers the held requests, and every later one, with this status. */
  fail(status?: number): void;
};

/**
 * Holds every request to `url` with `method` the app makes from now on.
 * A request the test's end interrupts is let go quietly.
 */
export async function holdRequests(
  page: Page,
  url: RegExp,
  method: string
): Promise<Hold> {
  let mode: 'hold' | 'pass' | number = 'hold';
  let wake = () => {};
  let woken = new Promise<void>((resolve) => {
    wake = resolve;
  });
  let seen = 0;
  await page.route(url, async (route) => {
    if (route.request().method() !== method) return route.fallback();
    seen += 1;
    while (mode === 'hold') await woken;
    try {
      if (mode === 'pass') await route.fallback();
      else await route.fulfill({ status: mode, json: {} });
    } catch {
      // The page closed while the request was held.
    }
  });
  const settle = (next: 'pass' | number) => {
    mode = next;
    wake();
    woken = new Promise<void>((resolve) => {
      wake = resolve;
    });
  };
  return {
    seen: () => seen,
    release: () => settle('pass'),
    fail: (status = 500) => settle(status),
  };
}

/** A fault of the provider's emulator (`crates/gmail_emulator/src/fault.rs`). */
export type ProviderFault = {
  /** `threads.get`, `threads.list`, ...; every route when absent. */
  route?: string;
  /** `forbidden`, `internal`, ...; without one the request succeeds late. */
  error?: string;
  delay_ms?: number;
  /** How many requests it applies to; every one when absent. */
  times?: number;
};

/**
 * Makes the provider of the test's inbox answer its mailbox's requests with
 * a fault, and answers how to take it back. Faults apply in the order they
 * were added: the first that matches a request is used.
 */
export async function providerFault(
  mailbox: Mailbox,
  fault: ProviderFault
): Promise<() => Promise<void>> {
  const base = emulatorUrl(mailbox, mailbox.inbox.provider);
  const response = await fetch(`${base}/_emulator/faults`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mailbox: mailbox.inbox.email, ...fault }),
  });
  if (!response.ok) {
    throw new Error(
      `fault refused: ${response.status} ${await response.text()}`
    );
  }
  const { id } = (await response.json()) as { id: number };
  return async () => {
    await fetch(`${base}/_emulator/faults/${id}`, { method: 'DELETE' });
  };
}

/**
 * Answers the app's connection-gateway socket in place of the fixture's
 * relay, for a test that waits on what the email services tell the app.
 * The fixture's socket leaves the app's pings unanswered, so the app drops
 * it every few seconds and reconnects a second later; what is sent in that
 * second never arrives. This one answers each ping, and passes on what is
 * sent to the user once the page first connects (not what was sent before,
 * such as the end of the first backfill, which would raise its notice
 * again). Call it before the page opens. Answers what stops it; it also
 * stops when the page closes.
 */
export async function steadyGateway(
  page: Page,
  mailbox: Mailbox
): Promise<() => Promise<void>> {
  const { stack, user } = mailbox;
  const mine = `/message/send/user/${user.macroUserId}`;
  const sentToUser = async () =>
    (await stack.serviceRequests()).filter(
      (request) =>
        request.service === 'connection-gateway' &&
        decodeURIComponent(request.path) === mine
    );
  let passed: number | undefined;
  let connected = false;
  const sockets = new Set<WebSocketRoute>();
  await page.routeWebSocket(/\/connection-gateway(\/|\?|$)/, (socket) => {
    sockets.add(socket);
    socket.onMessage((message) => {
      if (message === 'ping') socket.send('pong');
    });
    socket.onClose(() => sockets.delete(socket));
    connected = true;
  });
  let stopped = false;
  const relay = async () => {
    while (!stopped && !page.isClosed()) {
      try {
        const sent = connected ? await sentToUser() : undefined;
        if (sent && passed === undefined) passed = sent.length;
        else if (sent) {
          for (const request of sent.slice(passed)) {
            const body = request.body as {
              message_type: string;
              message: unknown;
            };
            const frame = JSON.stringify({
              type: body.message_type,
              data: JSON.stringify(body.message),
            });
            for (const socket of sockets) socket.send(frame);
          }
          passed = sent.length;
        }
      } catch {
        // A failed read, or a socket that closed under the send, leaves the
        // cursor where it is: the next round catches up.
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  };
  const relaying = relay();
  return async () => {
    stopped = true;
    await relaying;
  };
}

/**
 * Leaves the signed-in user with access to a Gmail inbox a teammate
 * connected first: the teammate links it, then the user connects the same
 * account and agrees to share it, as "Share inbox" in "Share this inbox?"
 * does (`connect-more.spec.ts` walks that dialog). Answers the link's id.
 */
export async function shareInbox(
  mailbox: Mailbox,
  address: string
): Promise<string> {
  const { stack, user } = mailbox;
  const teammate = await stack.user('bob@example.com');
  await stack.link(teammate, 'GMAIL', address);
  const attempt = crypto.randomUUID();
  await stack.sql(
    `INSERT INTO in_progress_user_link
       (id, macro_user_id, linked_email, email_provider, requested_google_scopes, granted_google_scopes)
     VALUES ('${attempt}', '${user.fusionUserId}', '${address}',
             'GMAIL'::email_user_provider_enum, ARRAY['${MAIL_SCOPE}']::text[], ARRAY['${MAIL_SCOPE}']::text[])
     RETURNING id`
  );
  const shared = await mailbox.api(
    `/email/email/init?link_id=${attempt}&force_share=true`,
    { method: 'POST' }
  );
  expect(shared.status, await shared.clone().text()).toBeLessThan(300);
  const listed = await mailbox.api('/email/email/links');
  const { links } = (await listed.json()) as {
    links: { id: string; email_address: string }[];
  };
  const link = links.find((candidate) => candidate.email_address === address);
  if (!link) throw new Error(`${address} is not among the user's inboxes`);
  return link.id;
}
