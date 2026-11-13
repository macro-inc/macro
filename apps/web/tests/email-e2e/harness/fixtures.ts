// A test's world: its own email stack, one signed-in user with one linked
// mailbox, and the built web app in the browser talking to that stack.

import { fileURLToPath } from 'node:url';
import {
  test as base,
  expect,
  type Page,
  type WebSocketRoute,
} from '@playwright/test';
import { type Front, type SignedInUser, startFront } from './front';
import {
  type LinkedInbox,
  type Mail,
  type Provider,
  type ProviderMessage,
  Stack,
} from './stack';

const DIST =
  process.env.EMAIL_E2E_DIST ?? fileURLToPath(new URL('../../../dist', import.meta.url));

/** A thread as the email service lists it. */
export type ThreadPreview = {
  id: string;
  name: string;
  [field: string]: unknown;
};

export type Mailbox = {
  stack: Stack;
  user: SignedInUser;
  inbox: LinkedInbox;
  front: Front;
  /** Puts a message in the mailbox at the provider, as if it just arrived. */
  deliver(mail: Mail): Promise<ProviderMessage>;
  /** What the provider holds. */
  providerMessages(): Promise<ProviderMessage[]>;
  /** Calls the email service as the signed-in user: `api('/email/threads/..')`. */
  api(path: string, init?: RequestInit): Promise<Response>;
  /**
   * Waits until Macro has synced a thread with this subject and answers its
   * preview. Mail delivered while a list is open only shows after this.
   */
  synced(subject: string): Promise<ThreadPreview>;
  /** Opens the app at `path` (default: the mail view). */
  open(path?: string): Promise<void>;
};

type Options = {
  /** The provider of the linked mailbox. */
  provider: Provider;
  /** Overrides of the services' environment. */
  stackEnv: Record<string, string>;
  /** The signed-in user's and the mailbox's address. */
  address: string;
};

/**
 * The connection gateway: the browser's socket is answered here, and what the
 * email services ask the gateway to send this user is passed on to it, in the
 * gateway's frame (`data` is JSON in a string).
 */
async function relayGateway(
  page: Page,
  stack: Stack,
  user: SignedInUser
): Promise<() => void> {
  const sockets = new Set<WebSocketRoute>();
  await page.routeWebSocket(/\/connection-gateway(\/|\?|$)/, (socket) => {
    sockets.add(socket);
    socket.onClose(() => sockets.delete(socket));
  });
  // Other sockets to services the stack does not run stay silent.
  await page.routeWebSocket(/\/websocket(\/|\?|$)/, () => {});

  const mine = `/message/send/user/${user.macroUserId}`;
  let passed = 0;
  let stopped = false;
  const pass = async () => {
    while (!stopped) {
      const sent = (await stack.serviceRequests().catch(() => [])).filter(
        (request) =>
          request.service === 'connection-gateway' &&
          decodeURIComponent(request.path) === mine
      );
      for (const request of sent.slice(passed)) {
        const body = request.body as { message_type: string; message: unknown };
        const frame = JSON.stringify({
          type: body.message_type,
          data: JSON.stringify(body.message),
        });
        for (const socket of sockets) socket.send(frame);
      }
      passed = sent.length;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  };
  const passing = pass();
  return () => {
    stopped = true;
    void passing;
  };
}

export const test = base.extend<Options & { mailbox: Mailbox }>({
  provider: ['GMAIL', { option: true }],
  stackEnv: [{}, { option: true }],
  address: ['ada@example.com', { option: true }],

  mailbox: async ({ page, provider, stackEnv, address }, use, testInfo) => {
    const stack = await Stack.start(stackEnv);
    const user = await stack.user(address);
    const inbox = await stack.link(user, provider);
    const front = await startFront({
      dist: DIST,
      emailUrl: stack.info.emailUrl,
      documentStorageUrl: stack.info.documentStorageUrl,
      internalApiKey: stack.info.internalApiKey,
      user,
    });

    await page.addInitScript(() => {
      localStorage.setItem('macro:login', 'true');
    });
    const stopRelay = await relayGateway(page, stack, user);

    const api = (path: string, init?: RequestInit) =>
      fetch(`${front.origin}${path}`, {
        ...init,
        headers: { 'x-email-link-id': inbox.linkId, ...init?.headers },
      });

    await use({
      stack,
      user,
      inbox,
      front,
      deliver: (mail) => stack.deliver(inbox.email, mail),
      providerMessages: () => stack.providerMessages(inbox.email),
      api,
      synced: async (subject) => {
        let found: ThreadPreview | undefined;
        await expect
          .poll(
            async () => {
              const response = await api('/email/email/threads/previews/cursor/all?limit=100');
              const page = (await response.json()) as { items: ThreadPreview[] };
              found = page.items.find((item) => item.name === subject);
              return found !== undefined;
            },
            { message: `Macro never synced "${subject}"`, timeout: 60_000 }
          )
          .toBe(true);
        return found as ThreadPreview;
      },
      open: async (path = '/app/mail') => {
        await page.goto(`${front.origin}${path}`);
      },
    });

    stopRelay();
    await front.close();
    if (testInfo.status !== testInfo.expectedStatus) {
      console.log(`service logs: ${stack.info.logDir}`);
    }
    await stack.finish();
  },
});

export { expect };
