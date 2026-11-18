// Helpers of `ways-home-connect.spec.ts` and `ways-settings-outlook.spec.ts`:
// Home for someone with no inbox, what a provider holds once Macro connected
// one of its accounts, and the authentication service's half of connecting
// an Outlook account through to a finished consent, which
// `harness/linking.ts` and `harness/ways-settings-more.ts` leave out (they
// stop at Microsoft's page).

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Locator, Page } from '@playwright/test';
import type { Mailbox } from './fixtures';
import { test as linking } from './linking';
import type { Provider } from './stack';

/** Desktop Home's list, which holds its empty state. */
export function homeList(page: Page): Locator {
  return page.getByRole('grid', { name: 'Home' });
}

/** The provider chooser the app opens when Outlook is offered too. */
export function chooser(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Connect email' });
}

/** A mailbox of the Gmail emulator, as its control API lists it. */
type GoogleAccount = { email: string; watch_expires_at: string | null };

/**
 * Whether Macro watches the mailbox at its provider: Google's push watch on a
 * Gmail mailbox, Microsoft's change subscription on an Outlook one. Connecting
 * an inbox leaves that there; without it none of its new mail is announced.
 */
export async function watchedAtProvider(
  mailbox: Mailbox,
  provider: Provider,
  address: string
): Promise<boolean> {
  if (provider === 'GMAIL') {
    const response = await fetch(
      `${mailbox.stack.info.gmailUrl}/_emulator/mailboxes`
    );
    const accounts = (await response.json()) as GoogleAccount[];
    const account = accounts.find(({ email }) => email === address);
    return typeof account?.watch_expires_at === 'string';
  }
  const response = await fetch(
    `${mailbox.stack.info.outlookUrl}/_emulator/subscriptions`
  );
  const subscriptions = (await response.json()) as { mailbox: string }[];
  return subscriptions.some((each) => each.mailbox === address);
}

/** The subjects Macro lists for one inbox of the signed-in user. */
export async function subjectsIn(
  mailbox: Mailbox,
  linkId: string
): Promise<string[]> {
  const response = await mailbox.api(
    '/email/email/threads/previews/cursor/all?limit=100',
    { headers: { 'x-email-link-id': linkId } }
  );
  const { items } = (await response.json()) as { items: { name: string }[] };
  return items.map(({ name }) => name);
}

/** An Outlook connection the app asked the authentication service to start. */
export type MicrosoftStart = {
  /** The id minted for the attempt. */
  linkId: string;
  /** Where the app asked to be sent back to. */
  originalUrl: string;
  /** The account picked on Microsoft's page, once consent came back. */
  address?: string;
};

export type MicrosoftAuth = {
  /** Every Outlook connection the app started, oldest first. */
  starts: MicrosoftStart[];
};

const CLIENT = { client_id: 'macro-e2e', client_secret: 'secret' };
const MICROSOFT_SCOPES = [
  'openid',
  'email',
  'offline_access',
  'Mail.ReadWrite',
];

/**
 * Answers `POST /auth/link/outlook` and Microsoft's redirect back as the
 * authentication service does: it redeems the code at the Outlook emulator,
 * holds the grant for the attempt (the emulator stands in for the service's
 * grant store, `link_mailbox`), records the finished consent that
 * `/email/init` reads, and returns the browser to the app.
 *
 * The service answers token requests for an inbox by its link id, which only
 * `/email/init` mints; the emulator learns it from that answer before the
 * browser gets it, as the stack's own linking does after the same call
 * (`start_link` in `crates/email_e2e/src/user.rs`).
 */
async function standInForMicrosoft(
  page: Page,
  mailbox: Mailbox
): Promise<MicrosoftAuth & { close(): Promise<void> }> {
  const { front, stack, user } = mailbox;
  const outlook = stack.info.outlookUrl;
  const starts: MicrosoftStart[] = [];
  const bind = async (address: string, linkId: string) => {
    const bound = await fetch(
      `${outlook}/_emulator/mailboxes/${encodeURIComponent(address)}/links/${linkId}`,
      { method: 'POST' }
    );
    if (!bound.ok) {
      throw new Error(`the emulator refused to bind ${linkId} to ${address}`);
    }
  };

  const callback = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://callback');
    const start = starts.find(
      (candidate) => candidate.linkId === url.searchParams.get('state')
    );
    if (!start) {
      response.writeHead(400).end('unknown state');
      return;
    }
    const back = new URL(start.originalUrl);
    back.searchParams.set('link_id', start.linkId);
    back.searchParams.set('provider', 'outlook');
    const finish = async () => {
      const code = url.searchParams.get('code');
      if (!code) {
        back.searchParams.set(
          'email_link_error',
          url.searchParams.get('error') === 'access_denied'
            ? 'cancelled'
            : 'failed'
        );
        return;
      }
      const redeemed = await fetch(`${outlook}/common/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          ...CLIENT,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
      });
      if (!redeemed.ok) {
        throw new Error(
          `code exchange answered ${redeemed.status}: ${await redeemed.text()}`
        );
      }
      const { id_token: idToken } = (await redeemed.json()) as {
        id_token: string;
      };
      const { email } = JSON.parse(
        Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8')
      ) as { email: string };
      start.address = email;
      await bind(email, start.linkId);
      await stack.sql(
        `INSERT INTO in_progress_user_link
           (id, macro_user_id, linked_email, email_provider, requested_google_scopes, granted_google_scopes)
         VALUES ('${start.linkId}', '${user.fusionUserId}', '${email}',
                 'OUTLOOK'::email_user_provider_enum, ARRAY[]::text[], ARRAY[]::text[])
         RETURNING id`
      );
    };
    try {
      await finish();
      response.writeHead(303, { location: back.toString() }).end();
    } catch (error: unknown) {
      response.writeHead(500).end(String(error));
    }
  });
  await new Promise<void>((resolve) =>
    callback.listen(0, '127.0.0.1', resolve)
  );
  const redirectUri = `http://localhost:${(callback.address() as AddressInfo).port}/oauth2/microsoft/callback`;

  front.stub(({ method, path, query }) => {
    if (method !== 'POST' || path !== '/auth/link/outlook') return undefined;
    const start: MicrosoftStart = {
      linkId: crypto.randomUUID(),
      originalUrl: decodeURIComponent(query.get('original_url') ?? ''),
    };
    starts.push(start);
    const authorization = new URL(`${outlook}/common/oauth2/v2.0/authorize`);
    authorization.search = new URLSearchParams({
      client_id: CLIENT.client_id,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: MICROSOFT_SCOPES.join(' '),
      state: start.linkId,
    }).toString();
    return {
      json: {
        authorization_url: authorization.toString(),
        link_id: start.linkId,
      },
    };
  });

  await page.route(/\/email\/email\/init(\?|$)/, async (route) => {
    const attempt = new URL(route.request().url()).searchParams.get('link_id');
    const start = starts.find((candidate) => candidate.linkId === attempt);
    if (!start?.address) return route.fallback();
    const response = await route.fetch();
    if (response.ok()) {
      const { link_id: linkId } = (await response.json()) as {
        link_id?: string;
      };
      if (linkId) await bind(start.address, linkId);
    }
    await route.fulfill({ response });
  });

  return {
    starts,
    close: () =>
      new Promise((resolve) => {
        callback.closeAllConnections();
        callback.close(() => resolve());
      }),
  };
}

export const test = linking.extend<{ microsoft: MicrosoftAuth }>({
  microsoft: async ({ page, mailbox }, use) => {
    const service = await standInForMicrosoft(page, mailbox);
    await use(service);
    await service.close();
  },
});

export { expect } from './linking';
