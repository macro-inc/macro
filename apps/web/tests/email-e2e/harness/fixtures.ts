// A test's world: its own email stack, one signed-in user with one linked
// mailbox, and the built web app in the browser talking to that stack.

import { fileURLToPath } from 'node:url';
import {
  test as base,
  expect,
  type Page,
  type WebSocketRoute,
} from '@playwright/test';
import { record } from '../ledger/record';
import { FROM_TEST, type Front, type SignedInUser, startFront } from './front';
import {
  type LinkedInbox,
  type Mail,
  type Provider,
  type ProviderMessage,
  Stack,
} from './stack';

const DIST =
  process.env.EMAIL_E2E_DIST ??
  fileURLToPath(new URL('../../../dist', import.meta.url));

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
): Promise<() => Promise<void>> {
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
      // A failed read leaves the cursor where it is: the next one catches up.
      const all = await stack.serviceRequests().catch(() => undefined);
      if (all === undefined) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        continue;
      }
      const sent = all.filter(
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
  return async () => {
    stopped = true;
    await passing;
  };
}

/** What the test did, for the coverage report (`ledger/README.md`). */
type Evidence = Awaited<ReturnType<typeof record>>;

export const test = base.extend<
  Options & { mailbox: Mailbox; evidence: Evidence }
>({
  provider: ['GMAIL', { option: true }],
  stackEnv: [{}, { option: true }],
  address: ['ada@example.com', { option: true }],

  evidence: [
    async ({ page, provider, hasTouch }, use, testInfo) => {
      const evidence = record(page, testInfo, provider, hasTouch);
      await use(evidence);
      evidence.finish();
    },
    { auto: true },
  ],

  mailbox: async (
    { page, provider, stackEnv, address, evidence },
    use,
    testInfo
  ) => {
    const stack = await Stack.start(stackEnv);
    let failed = true;
    try {
      await serve(stack);
      failed = testInfo.status !== testInfo.expectedStatus;
    } finally {
      // Whatever went wrong, the stack's services and database go away.
      if (failed) console.log(`service logs: ${stack.info.logDir}`);
      await stack.finish();
    }

    async function serve(stack: Stack): Promise<void> {
      const user = await stack.user(address);
      const inbox = await stack.link(user, provider);
      const front = await startFront({
        dist: DIST,
        emailUrl: stack.info.emailUrl,
        documentStorageUrl: stack.info.documentStorageUrl,
        internalApiKey: stack.info.internalApiKey,
        user,
      });
      evidence.requests(front.requests);

      try {
        await page.addInitScript(() => {
          localStorage.setItem('macro:login', 'true');
        });
        // Proving a test (`ledger/README.md`): a bundle built with breaks
        // that each wait for a name, and the one this run switches on.
        const broken = process.env.EMAIL_E2E_BREAK;
        if (broken) {
          await page.addInitScript((name) => {
            (globalThis as { emailE2eBreak?: string }).emailE2eBreak = name;
          }, broken);
        }
        // A change of the machine's network (another container starting)
        // makes Chrome drop the requests in flight and leaves the page
        // without part of the app. The test process fetches the app's own
        // files instead; no such change reaches it.
        await page.route(
          (url) => url.pathname.startsWith('/app/'),
          async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            try {
              const response = await route.fetch();
              await route.fulfill({ response });
            } catch {
              // The test ended meanwhile, or the fetch could not be made.
              await route.fallback().catch(() => undefined);
            }
          }
        );
        const stopRelay = await relayGateway(page, stack, user);

        const api = (path: string, init?: RequestInit) =>
          fetch(`${front.origin}${path}`, {
            ...init,
            headers: {
              'x-email-link-id': inbox.linkId,
              [FROM_TEST]: '1',
              ...init?.headers,
            },
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
                  const response = await api(
                    '/email/email/threads/previews/cursor/all?limit=100'
                  );
                  const page = (await response.json()) as {
                    items: ThreadPreview[];
                  };
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

        await stopRelay();
      } finally {
        await front.close();
      }
    }
  },
});

export { expect };
