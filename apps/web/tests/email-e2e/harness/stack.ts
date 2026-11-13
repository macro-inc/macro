// The email stack a test runs against, over the HTTP routes of
// `email_e2e_stacks` (crates/email_e2e/src/stack_server.rs).

import type { SignedInUser } from './front';

export type Provider = 'GMAIL' | 'OUTLOOK';

export type StackInfo = {
  id: string;
  emailUrl: string;
  documentStorageUrl: string;
  gmailUrl: string;
  outlookUrl: string;
  internalApiKey: string;
  logDir: string;
};

export type LinkedInbox = { linkId: string; email: string; provider: Provider };

/** A message to put in a mailbox at the provider. */
export type Mail = {
  /** The sender, as a header value: `Ada <ada@example.com>`. */
  from: string;
  subject: string;
  text?: string;
  html?: string;
  /** The recipients, as a header value. The mailbox itself when absent. */
  to?: string;
  cc?: string;
  /** Without angle brackets. */
  messageId?: string;
  /** The `Message-ID` this replies to, which puts it in that thread. */
  inReplyTo?: string;
  attachments?: { filename: string; mimeType: string; base64: string }[];
};

/** A message as the provider holds it. */
export type ProviderMessage = {
  id: string;
  threadId: string;
  subject: string;
  from: string | null;
  read: boolean;
  starred: boolean;
  inInbox: boolean;
  labels: string[];
};

export type ServiceRequest = {
  service: string;
  method: string;
  path: string;
  body: unknown;
};

function stacksUrl(): string {
  const url = process.env.EMAIL_E2E_STACKS_URL;
  if (!url)
    throw new Error('EMAIL_E2E_STACKS_URL is not set: see global-setup.ts');
  return url;
}

async function call<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const response = await fetch(`${stacksUrl()}${path}`, {
    method,
    headers:
      body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} answered ${response.status}:\n${text}`);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

export class Stack {
  private constructor(readonly info: StackInfo) {}

  /** Starts a stack; `env` overrides the services' environment. */
  static async start(env: Record<string, string> = {}): Promise<Stack> {
    return new Stack(await call<StackInfo>('POST', '/stacks', { env }));
  }

  private path(rest: string): string {
    return `/stacks/${this.info.id}${rest}`;
  }

  user(email: string): Promise<SignedInUser> {
    return call('POST', this.path('/users'), { email });
  }

  /** Links a mailbox to the user and waits for its first sync. */
  link(
    user: SignedInUser,
    provider: Provider,
    address = user.email
  ): Promise<LinkedInbox> {
    return call('POST', this.path('/inboxes'), {
      user: user.email,
      provider,
      address,
    });
  }

  /** Puts a message in the mailbox at the provider, as if it just arrived. */
  deliver(address: string, mail: Mail): Promise<ProviderMessage> {
    return call(
      'POST',
      this.path(`/inboxes/${encodeURIComponent(address)}/messages`),
      mail
    );
  }

  providerMessages(address: string): Promise<ProviderMessage[]> {
    return call(
      'GET',
      this.path(`/inboxes/${encodeURIComponent(address)}/messages`)
    );
  }

  /** What the email services asked the other Macro services. */
  serviceRequests(): Promise<ServiceRequest[]> {
    return call('GET', this.path('/service-requests'));
  }

  /** Makes a Macro service stand-in answer an error once. */
  failNextServiceRequest(failure: {
    service: 'static-files' | 'document-storage' | 'connection-gateway';
    method: string;
    pathPrefix?: string;
    status?: number;
    body?: unknown;
  }): Promise<void> {
    return call('POST', this.path('/service-failures'), failure);
  }

  /** Refuses the email services' next sends to one of their queues. */
  refuseQueueSends(queue: string, times = 1): Promise<void> {
    return call('POST', this.path('/queue-refusals'), { queue, times });
  }

  /** What the services stored in object storage. */
  storedObjects(): Promise<
    { bucket: string; key: string; contentType: string; base64: string }[]
  > {
    return call('GET', this.path('/stored-objects'));
  }

  /** Puts mail in a mailbox before anyone links it: what a backfill finds. */
  seed(provider: Provider, address: string, mail: Mail[]): Promise<void> {
    return call('POST', this.path('/seed'), { provider, address, mail });
  }

  /**
   * Runs a row-returning query on the stack's database. The last resort,
   * for state no API or page shows.
   */
  sql<Row = Record<string, unknown>>(query: string): Promise<Row[]> {
    return call('POST', this.path('/sql'), { query });
  }

  runScheduledSweep(): Promise<void> {
    return call('POST', this.path('/scheduled-sweep'));
  }

  /** Ends the stack. Rejects when a service died or panicked. */
  async finish(): Promise<void> {
    // The server answers 409 while another request of this test is still
    // being answered; that request ends by itself.
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(`${stacksUrl()}${this.path('')}`, {
        method: 'DELETE',
      });
      if (response.ok) return;
      if (response.status !== 409 || attempt === 50) {
        throw new Error(
          `the stack did not end (${response.status}):\n${await response.text()}`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}
