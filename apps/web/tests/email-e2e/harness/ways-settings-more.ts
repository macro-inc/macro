// More helpers of the `ways-settings-*` specs: opening Settings once the
// inbox list has stopped changing, a picture the email service keeps as it
// is, and the authentication service's half of connecting an inbox with the
// two refusals a consent screen can end in (`harness/linking.ts` stands in
// only for a consent that grants everything or is cancelled).

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Page } from '@playwright/test';
import { test as base, expect, type Mailbox } from './fixtures';
import { SETTINGS } from './ways-settings';

/** Whether the email service told the app that the inbox finished its backfill. */
async function backfillAnnounced(mailbox: Mailbox): Promise<boolean> {
  const mine = `/message/send/user/${mailbox.user.macroUserId}`;
  return (await mailbox.stack.serviceRequests()).some((request) => {
    if (request.service !== 'connection-gateway') return false;
    if (decodeURIComponent(request.path) !== mine) return false;
    const body = request.body as {
      message_type?: string;
      message?: { event?: string; status?: string; link_id?: string };
    };
    return (
      body.message_type === 'refresh_email' &&
      body.message?.event === 'backfill_progress' &&
      body.message.status === 'complete' &&
      body.message.link_id === mailbox.inbox.linkId
    );
  });
}

/**
 * Opens a page that lists the inboxes once that list has stopped changing.
 * A Gmail inbox announces the end of its first backfill over the gateway,
 * and the app reads the list again when it hears it, which rebuilds each
 * inbox's row: a signature editor opened before that is closed again by it.
 * So for Gmail the page opens only after that announcement went out, which
 * the page, not connected yet, never hears; an Outlook inbox announces none.
 *
 * Waiting for a second read of the list instead would wait for one an
 * Outlook inbox never causes.
 */
export async function openSettled(
  page: Page,
  mailbox: Mailbox,
  path: string = SETTINGS
): Promise<void> {
  if (mailbox.inbox.provider === 'GMAIL') {
    await expect
      .poll(() => backfillAnnounced(mailbox), {
        message: 'the Gmail inbox never announced the end of its backfill',
        timeout: 60_000,
      })
      .toBe(true);
  }
  const listed = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname.endsWith('/email/links')
  );
  await mailbox.open(path);
  await listed;
}

// A one-pixel PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

/**
 * The address of a picture already on Macro's file service, which the
 * browser shows. The email service keeps such a picture as it is when it
 * saves a signature, instead of fetching it to store it there
 * (`rehost_html_images`); one at any other address is fetched, and the
 * stack's own addresses are loopback ones the service refuses to fetch. The
 * stack runs no file service, so its answer is given here, as `render.spec.ts`
 * does for the pictures of a message.
 *
 * Replaces `servePicture` of `harness/ways-settings.ts` for a signature that
 * is saved.
 */
export async function filedPicture(page: Page): Promise<string> {
  const url = 'https://static-file-service.example/signature/logo.png';
  await page.route(url, (route) =>
    route.fulfill({
      contentType: 'image/png',
      headers: { 'cross-origin-resource-policy': 'cross-origin' },
      body: PNG,
    })
  );
  return url;
}

/** What the app asked the authentication service when it started a connection. */
export type LinkStart = {
  provider: 'GMAIL' | 'OUTLOOK';
  /** The app's `scopes` parameter: which permissions consent should ask for. */
  scopes: string | null;
  /** Where the app asked to be sent back to. */
  originalUrl: string;
  /** The id minted for the attempt. */
  linkId: string;
};

export type AuthService = {
  /** Every connection the app started, oldest first. */
  starts: LinkStart[];
  /** Adds a Google account, with its mailbox, that nobody has connected yet. */
  googleAccount(account: { email: string }): Promise<void>;
};

export const MAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';

const GOOGLE_SCOPES: Record<string, string[]> = {
  gmail: [MAIL_SCOPE],
  calendar: ['https://www.googleapis.com/auth/calendar'],
  gmail_and_calendar: [MAIL_SCOPE, 'https://www.googleapis.com/auth/calendar'],
};

const MICROSOFT_SCOPES = [
  'openid',
  'email',
  'offline_access',
  'Mail.ReadWrite',
];

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
 * Why a consent screen came back without a code, as the authentication
 * service classifies Microsoft's answer (`ConsentFailure::classify`).
 */
function consentFailure(url: URL): string {
  const error = url.searchParams.get('error');
  const code = url.searchParams.get('error_description')?.split(':')[0];
  if (
    code === 'AADSTS65001' ||
    code === 'AADSTS90094' ||
    error === 'consent_required' ||
    error === 'interaction_required'
  ) {
    return 'admin_consent_required';
  }
  return error === 'access_denied' ? 'cancelled' : 'failed';
}

/**
 * Answers the app's connect-inbox calls as the authentication service does,
 * and the providers' redirects back. Copied from `harness/linking.ts`, with
 * what that one leaves out: a Google consent whose mail permission was
 * unchecked comes back as `gmail_not_granted` without connecting anything
 * (`google.rs` of the service), and an Outlook connection goes to the Outlook
 * emulator's account picker, where "Need admin approval" comes back as
 * `admin_consent_required`. A Microsoft consent that grants access is not
 * finished here: nothing in these specs needs one.
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
    back.searchParams.set(
      'provider',
      start.provider === 'GMAIL' ? 'gmail' : 'outlook'
    );
    const finish = async () => {
      const code = url.searchParams.get('code');
      if (!code) {
        back.searchParams.set('email_link_error', consentFailure(url));
        return;
      }
      if (start.provider === 'OUTLOOK') {
        throw new Error('this stand-in does not finish a Microsoft consent');
      }
      const granted = (url.searchParams.get('scope') ?? '').split(' ');
      if (!granted.includes(MAIL_SCOPE)) {
        back.searchParams.set('email_link_error', 'gmail_not_granted');
        return;
      }
      const address = await consentedAddress(
        stack.info.gmailUrl,
        code,
        `${callbackOrigin}/oauth2/google/callback`
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
  const callbackOrigin = `http://localhost:${(callback.address() as AddressInfo).port}`;

  front.stub(({ method, path, query }) => {
    if (path === '/auth/link/email/providers') {
      return {
        json: { outlook: outlookOffered, outlook_admin_consent_url: null },
      };
    }
    if (method !== 'POST') return undefined;
    if (path !== '/auth/link/gmail' && path !== '/auth/link/outlook') {
      return undefined;
    }
    const provider = path === '/auth/link/gmail' ? 'GMAIL' : 'OUTLOOK';
    const start: LinkStart = {
      provider,
      scopes: query.get('scopes'),
      originalUrl: decodeURIComponent(query.get('original_url') ?? ''),
      linkId: crypto.randomUUID(),
    };
    starts.push(start);
    const authorization =
      provider === 'GMAIL'
        ? new URL(`${stack.info.gmailUrl}/o/oauth2/v2/auth`)
        : new URL(`${stack.info.outlookUrl}/common/oauth2/v2.0/authorize`);
    const scope =
      provider === 'GMAIL'
        ? ['openid', 'email', ...(GOOGLE_SCOPES[start.scopes ?? 'gmail'] ?? [])]
        : MICROSOFT_SCOPES;
    authorization.search = new URLSearchParams({
      client_id: CLIENT.client_id,
      redirect_uri: `${callbackOrigin}/oauth2/${provider === 'GMAIL' ? 'google' : 'microsoft'}/callback`,
      response_type: 'code',
      scope: scope.join(' '),
      state: start.linkId,
    }).toString();
    return {
      json: {
        authorization_url: authorization.toString(),
        link_id: start.linkId,
      },
    };
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

export { connectedInboxes } from './ways-settings';
export { expect };

/**
 * On Google's consent page, withholds the mail permission and picks the
 * account: the consent comes back without access to the mailbox.
 */
export async function refuseMailAccess(
  page: Page,
  address: string
): Promise<void> {
  await page.waitForURL(/\/o\/oauth2\/v2\/auth/);
  await page.getByRole('checkbox', { name: MAIL_SCOPE }).uncheck();
  await page
    .getByRole('button', { name: new RegExp(address.replace(/\./g, '\\.')) })
    .click();
}
