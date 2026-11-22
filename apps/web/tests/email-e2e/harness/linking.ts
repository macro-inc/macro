// The authentication service's half of connecting an inbox, which the stack
// does not run: the routes the app calls to start a connection, and the
// provider callback that records the finished consent and sends the browser
// back to the app. The consent screen itself is the Gmail emulator's own page.

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test as base, expect, type Mailbox } from './fixtures';

/** What the app asked the authentication service when it started a connection. */
export type LinkStart = {
  provider: 'GMAIL' | 'OUTLOOK';
  /** The app's `scopes` parameter: which permissions consent should ask for. */
  scopes: string | null;
  reconnectLinkId: string | null;
  /** Where the app asked to be sent back to. */
  originalUrl: string;
  /** The id minted for the attempt. */
  linkId: string;
};

export type AuthService = {
  /** Every connection the app started, oldest first. */
  starts: LinkStart[];
  /** Adds a Google account, with its mailbox, that nobody has connected yet. */
  googleAccount(account: {
    email: string;
    send_as?: { email: string; name?: string }[];
  }): Promise<void>;
};

const GOOGLE_SCOPES: Record<string, string[]> = {
  gmail: ['https://www.googleapis.com/auth/gmail.modify'],
  calendar: ['https://www.googleapis.com/auth/calendar'],
  gmail_and_calendar: [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/calendar',
  ],
};

const CLIENT = { client_id: 'macro-e2e', client_secret: 'secret' };

/** The address of the Google account a consent finished with. */
async function consentedAddress(
  gmailUrl: string,
  code: string,
  redirectUri: string
): Promise<string> {
  const response = await fetch(`${gmailUrl}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ...CLIENT,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `code exchange answered ${response.status}: ${await response.text()}`
    );
  }
  const { id_token: idToken } = (await response.json()) as { id_token: string };
  const claims = JSON.parse(
    Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8')
  ) as { email: string };
  return claims.email;
}

/**
 * Answers the app's connect-inbox calls as the authentication service does,
 * and Google's redirect back: it records the consent (the pending link that
 * `/email/init` reads) and returns the browser to the app.
 */
async function startAuthService(
  mailbox: Mailbox,
  outlookOffered: boolean
): Promise<AuthService & { close(): Promise<void> }> {
  const { front, stack, user } = mailbox;
  const starts: LinkStart[] = [];

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
    back.searchParams.set('provider', 'gmail');
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
      const address = await consentedAddress(
        stack.info.gmailUrl,
        code,
        redirectUri
      );
      const scopes = (GOOGLE_SCOPES[start.scopes ?? 'gmail'] ?? [])
        .map((scope) => `'${scope}'`)
        .join(',');
      await stack.sql(
        `INSERT INTO in_progress_user_link
           (id, macro_user_id, linked_email, email_provider, requested_google_scopes, granted_google_scopes)
         VALUES ('${start.linkId}', '${user.fusionUserId}', '${address}',
                 'GMAIL'::email_user_provider_enum, ARRAY[${scopes}]::text[], ARRAY[${scopes}]::text[])
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
  const redirectUri = `http://localhost:${(callback.address() as AddressInfo).port}/oauth2/google/callback`;

  front.stub(({ method, path, query }) => {
    if (path === '/auth/link/email/providers') {
      return {
        json: { outlook: outlookOffered, outlook_admin_consent_url: null },
      };
    }
    if (method === 'POST' && path === '/auth/link/gmail') {
      const start: LinkStart = {
        provider: 'GMAIL',
        scopes: query.get('scopes'),
        reconnectLinkId: query.get('reconnect_link_id'),
        originalUrl: decodeURIComponent(query.get('original_url') ?? ''),
        linkId: crypto.randomUUID(),
      };
      starts.push(start);
      const authorization = new URL(`${stack.info.gmailUrl}/o/oauth2/v2/auth`);
      authorization.search = new URLSearchParams({
        client_id: CLIENT.client_id,
        redirect_uri: redirectUri,
        response_type: 'code',
        access_type: 'offline',
        scope: [
          'openid',
          'email',
          ...(GOOGLE_SCOPES[start.scopes ?? 'gmail'] ?? []),
        ].join(' '),
        state: start.linkId,
      }).toString();
      return {
        json: {
          authorization_url: authorization.toString(),
          link_id: start.linkId,
        },
      };
    }
    return undefined;
  });

  return {
    starts,
    googleAccount: async (account) => {
      const response = await fetch(
        `${stack.info.gmailUrl}/_emulator/mailboxes`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(account),
        }
      );
      if (!response.ok) {
        throw new Error(
          `the emulator refused ${account.email}: ${await response.text()}`
        );
      }
    },
    close: () =>
      new Promise((resolve) => {
        callback.closeAllConnections();
        callback.close(() => resolve());
      }),
  };
}

export const test = base.extend<{
  /** Whether the server offers Outlook, which makes the app ask for a provider. */
  outlookOffered: boolean;
  auth: AuthService;
}>({
  outlookOffered: [false, { option: true }],
  auth: async ({ mailbox, outlookOffered }, use) => {
    const service = await startAuthService(mailbox, outlookOffered);
    await use(service);
    await service.close();
  },
});

export { expect };
