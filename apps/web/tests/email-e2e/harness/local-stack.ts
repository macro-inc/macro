// The local stack (`just run_local`) as the stack of a test: every Macro
// service, the gateway socket, the authentication service and the proxy are
// the real ones, and one instance serves every test. A test stays apart from
// the others by its own user and its own mailboxes at the stack's emulators.
//
// A user signs in at the authentication service (a passwordless code, which a
// local build answers in the response) and links a mailbox through the
// service's own link routes and the emulator's consent, as the app does.

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import type { SignedInUser } from './front';
import { send, sendJson } from './http';
import { clearSignUpCounters } from './sign-up-limit';
import type {
  EmailStack,
  LinkedInbox,
  Mail,
  Provider,
  ProviderMessage,
  StackInfo,
} from './stack';

const run = promisify(execFile);

/** Where the running stack is: `just email-e2e-full-stack` sets these. */
export type LocalStackAddresses = {
  /** The stack's HTTPS proxy, which every service is behind. */
  proxyUrl: string;
  gmailUrl: string;
  outlookUrl: string;
  databaseUrl: string;
  /** The stack's own Redis, where sign-ups are counted (`sign-up-limit.ts`). */
  redisUrl: string;
};

/** The running stack's addresses, or nothing when tests bring their own. */
export function localStackAddresses(): LocalStackAddresses | undefined {
  const proxyUrl = process.env.EMAIL_E2E_STACK_PROXY_URL;
  if (!proxyUrl) return undefined;
  const need = (name: string): string => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set beside the proxy's URL`);
    return value;
  };
  return {
    proxyUrl: proxyUrl.replace(/\/$/, ''),
    gmailUrl: need('EMAIL_E2E_STACK_GMAIL_URL').replace(/\/$/, ''),
    outlookUrl: need('EMAIL_E2E_STACK_OUTLOOK_URL').replace(/\/$/, ''),
    databaseUrl: need('EMAIL_E2E_STACK_DATABASE_URL'),
    redisUrl: need('EMAIL_E2E_STACK_REDIS_URL'),
  };
}

function needsOwnStack(what: string): never {
  throw new Error(
    `${what} needs a stack of the test's own: the local stack is shared`
  );
}

/** The `name=value` pairs of the cookies an answer sets. */
function cookies(answer: { headers: Record<string, unknown> }): string {
  const set = answer.headers['set-cookie'];
  const all = Array.isArray(set) ? set : typeof set === 'string' ? [set] : [];
  return all.map((cookie: string) => cookie.split(';')[0]).join('; ');
}

function location(answer: { headers: Record<string, unknown> }): string {
  const header = answer.headers.location;
  if (typeof header !== 'string') throw new Error('no redirect was answered');
  return header;
}

type GmailMessage = {
  id: string;
  thread_id: string;
  labels: string[];
  subject?: string;
  from?: string;
};

type OutlookMessage = {
  id: string;
  conversation_id: string;
  folder: string;
  subject: string;
  from: string | null;
  is_read: boolean;
  flagged: boolean;
  categories: string[];
};

function fromGmail(message: GmailMessage): ProviderMessage {
  return {
    id: message.id,
    threadId: message.thread_id,
    subject: message.subject ?? '',
    from: message.from ?? null,
    read: !message.labels.includes('UNREAD'),
    starred: message.labels.includes('STARRED'),
    inInbox: message.labels.includes('INBOX'),
    labels: message.labels,
  };
}

function fromOutlook(message: OutlookMessage): ProviderMessage {
  return {
    id: message.id,
    threadId: message.conversation_id,
    subject: message.subject,
    from: message.from,
    read: message.is_read,
    starred: message.flagged,
    inInbox: message.folder.toLowerCase() === 'inbox',
    labels: [message.folder, ...message.categories],
  };
}

/** A message as either emulator's control API takes it. */
function newMessage(mail: Mail): Record<string, unknown> {
  return {
    from: mail.from,
    to: mail.to,
    cc: mail.cc,
    subject: mail.subject,
    text: mail.text ?? '',
    html: mail.html,
    message_id: mail.messageId,
    in_reply_to: mail.inReplyTo,
    attachments: (mail.attachments ?? []).map((attachment) => ({
      filename: attachment.filename,
      mime_type: attachment.mimeType,
      base64: attachment.base64,
    })),
  };
}

export class LocalStack implements EmailStack {
  readonly info: StackInfo;
  /** Which emulator holds a mailbox this test made. */
  private readonly providers = new Map<string, Provider>();
  private readonly users = new Map<string, SignedInUser>();
  private readonly linked: { user: SignedInUser; linkId: string }[] = [];
  /**
   * This test's own domain, as long as `example.com`: the app cuts a long
   * address short where it shows one.
   */
  private readonly domain = `${[...randomBytes(6)]
    .map((byte) => (byte % 36).toString(36))
    .join('')}.test`;

  constructor(private readonly addresses: LocalStackAddresses) {
    this.info = {
      id: 'local-stack',
      emailUrl: `${addresses.proxyUrl}/email`,
      documentStorageUrl: `${addresses.proxyUrl}/dss`,
      gmailUrl: addresses.gmailUrl,
      outlookUrl: addresses.outlookUrl,
      // The stack's services take a session, never the gateway's own key.
      internalApiKey: '',
      logDir: 'the stack’s containers (`just run_local logs`)',
    };
  }

  /**
   * An address no other test uses, the same one each time the test names
   * it: the stack and its emulators are shared, so two tests cannot both be
   * `ada@example.com`. The test's people keep their names and share a domain.
   */
  address(address: string): string {
    return `${address.split('@')[0]}@${this.domain}`;
  }

  private emulator(provider: Provider): string {
    return provider === 'GMAIL' ? this.info.gmailUrl : this.info.outlookUrl;
  }

  private mailboxUrl(address: string, rest = ''): string {
    const provider = this.providers.get(address);
    if (!provider) throw new Error(`this test made no mailbox ${address}`);
    return `${this.emulator(provider)}/_emulator/mailboxes/${encodeURIComponent(address)}${rest}`;
  }

  /** Creates the mailbox at the provider unless this test already did. */
  private async mailbox(provider: Provider, address: string): Promise<void> {
    if (this.providers.has(address)) return;
    await sendJson(`${this.emulator(provider)}/_emulator/mailboxes`, {
      method: 'POST',
      body: { email: address },
    });
    this.providers.set(address, provider);
  }

  /** Signs a new user in at the authentication service. */
  async user(email: string): Promise<SignedInUser> {
    const { proxyUrl } = this.addresses;
    // One address signs up every test's user: see `sign-up-limit.ts`.
    await clearSignUpCounters(this.addresses.redisUrl);
    const { code } = await sendJson<{ code: string }>(
      `${proxyUrl}/auth/login/passwordless`,
      { method: 'POST', body: { email, redirect_uri: `${proxyUrl}/app` } }
    );
    const signedIn = await send(
      `${proxyUrl}/auth/oauth/passwordless/${code}?email=${encodeURIComponent(email)}`
    );
    const cookie = cookies(signedIn);
    const token = /access-token=([^;]+)/.exec(cookie)?.[1];
    if (signedIn.status !== 303 || !token) {
      throw new Error(
        `${email} could not sign in (${signedIn.status}):\n${signedIn.body.toString('utf8')}`
      );
    }
    const claims = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8')
    ) as { macro_user_id: string; fusion_user_id: string };
    const user: SignedInUser = {
      email,
      macroUserId: claims.macro_user_id,
      fusionUserId: claims.fusion_user_id,
      cookie,
    };
    // A new account opens on onboarding; these tests are of the mail views.
    await this.as(user, '/auth/user/tutorial', {
      method: 'PATCH',
      body: { tutorialComplete: true },
    });
    this.users.set(email, user);
    return user;
  }

  /** A call to a service as the user, through the proxy. */
  private as<T>(
    user: SignedInUser,
    path: string,
    init: {
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
    } = {}
  ): Promise<T> {
    return sendJson<T>(`${this.addresses.proxyUrl}${path}`, {
      ...init,
      headers: { cookie: user.cookie ?? '', ...init.headers },
    });
  }

  /**
   * Links a mailbox as the app does: the authentication service starts the
   * connection, the provider's consent is given for the mailbox's account,
   * the service's callback records the grant, and the email service takes
   * the inbox. Answers once its first sync is complete.
   */
  async link(
    user: SignedInUser,
    provider: Provider,
    named = user.email
  ): Promise<LinkedInbox> {
    const address = this.address(named);
    await this.mailbox(provider, address);
    const back = `${this.addresses.proxyUrl}/app/mail`;
    const { authorization_url: authorization } = await this.as<{
      authorization_url: string;
    }>(
      user,
      `/auth/link/${provider === 'GMAIL' ? 'gmail' : 'outlook'}?original_url=${encodeURIComponent(back)}`,
      { method: 'POST' }
    );

    // The consent page's own form: the request's parameters, the account
    // and, at Google, each permission it grants.
    const page = new URL(authorization);
    const form = new URLSearchParams(page.search);
    form.set('user', address);
    if (provider === 'GMAIL') {
      for (const scope of (form.get('scope') ?? '').split(' ')) {
        form.append('granted', scope);
      }
    }
    const consented = await send(`${page.origin}${page.pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (consented.status < 300 || consented.status >= 400) {
      throw new Error(
        `the consent for ${address} answered ${consented.status}:\n${consented.body.toString('utf8')}`
      );
    }
    const recorded = await send(location(consented), {
      headers: { cookie: user.cookie ?? '' },
    });
    const returned = new URL(location(recorded));
    const pending = returned.searchParams.get('link_id');
    if (!pending) throw new Error(`the link did not finish: ${returned}`);

    const { link_id: linkId } = await this.as<{ link_id: string }>(
      user,
      `/email/email/init?link_id=${pending}`,
      { method: 'POST' }
    );
    this.linked.push({ user, linkId });
    await this.synced(user, linkId);
    if (provider === 'OUTLOOK') await this.subscribed(address);
    return { linkId, email: address, provider };
  }

  /**
   * Waits for the service's Graph subscription to the mailbox: mail delivered
   * before it exists is announced to no one, and arrives only with the poll.
   */
  private async subscribed(address: string): Promise<void> {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const subscriptions = await sendJson<{ mailbox: string }[]>(
        `${this.info.outlookUrl}/_emulator/subscriptions`
      );
      if (subscriptions.some(({ mailbox }) => mailbox === address)) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Macro never subscribed to ${address}`);
  }

  private async synced(user: SignedInUser, linkId: string): Promise<void> {
    const deadline = Date.now() + 90_000;
    let last = '';
    while (Date.now() < deadline) {
      const { links } = await this.as<{
        links: { id: string; sync_status: string }[];
      }>(user, '/email/email/links');
      last = links.find((link) => link.id === linkId)?.sync_status ?? 'absent';
      if (last === 'UP_TO_DATE') return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`the inbox ${linkId} never synced: it is ${last}`);
  }

  async deliver(address: string, mail: Mail): Promise<ProviderMessage> {
    const { id } = await sendJson<{ id: string }>(
      this.mailboxUrl(address, '/messages'),
      { method: 'POST', body: newMessage(mail) }
    );
    const delivered = (await this.providerMessages(address)).find(
      (message) => message.id === id
    );
    if (!delivered) throw new Error(`${address} does not hold ${id}`);
    return delivered;
  }

  async providerMessages(address: string): Promise<ProviderMessage[]> {
    const url = this.mailboxUrl(address, '/messages');
    return this.providers.get(address) === 'GMAIL'
      ? (await sendJson<GmailMessage[]>(url)).map(fromGmail)
      : (await sendJson<OutlookMessage[]>(url)).map(fromOutlook);
  }

  async seed(provider: Provider, named: string, mail: Mail[]): Promise<void> {
    const address = this.address(named);
    await this.mailbox(provider, address);
    for (const each of mail) {
      await sendJson(this.mailboxUrl(address, '/messages'), {
        method: 'POST',
        body: newMessage(each),
      });
    }
  }

  async sql<Row = Record<string, unknown>>(query: string): Promise<Row[]> {
    const { stdout } = await run('psql', [
      this.addresses.databaseUrl,
      '--no-psqlrc',
      '--tuples-only',
      '--no-align',
      '--set=ON_ERROR_STOP=1',
      '--command',
      `WITH rows AS (${query}) SELECT coalesce(jsonb_agg(to_jsonb(rows)), '[]')::text FROM rows`,
    ]);
    return JSON.parse(stdout) as Row[];
  }

  serviceRequests(): never {
    return needsOwnStack('What the services asked each other');
  }

  failNextServiceRequest(): never {
    return needsOwnStack('A failing Macro service');
  }

  refuseQueueSends(): never {
    return needsOwnStack('A refused queue');
  }

  storedObjects(): never {
    return needsOwnStack('Reading object storage');
  }

  runScheduledSweep(): never {
    return needsOwnStack('Running the scheduled sweep');
  }

  /**
   * The stack outlives the test and its users stay, but their inboxes are
   * disconnected: the services would otherwise keep every finished test's
   * mailbox in sync for the rest of the run.
   */
  async finish(): Promise<void> {
    const kept: string[] = [];
    for (const { user, linkId } of this.linked) {
      const removed = await send(
        `${this.addresses.proxyUrl}/email/email/links/${linkId}`,
        { method: 'DELETE', headers: { cookie: user.cookie ?? '' } }
      );
      if (removed.status !== 204 && removed.status !== 404) {
        kept.push(
          `the inbox ${linkId} was not disconnected (${removed.status}):\n${removed.body.toString('utf8')}`
        );
      }
    }
    if (kept.length > 0) throw new Error(kept.join('\n'));
  }
}
