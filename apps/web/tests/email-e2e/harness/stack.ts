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
  if (!url) throw new Error('EMAIL_E2E_STACKS_URL is not set: see global-setup.ts');
  return url;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${stacksUrl()}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
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
  link(user: SignedInUser, provider: Provider, address = user.email): Promise<LinkedInbox> {
    return call('POST', this.path('/inboxes'), {
      user: user.email,
      provider,
      address,
    });
  }

  /** Puts a message in the mailbox at the provider, as if it just arrived. */
  deliver(address: string, mail: Mail): Promise<ProviderMessage> {
    return call('POST', this.path(`/inboxes/${encodeURIComponent(address)}/messages`), mail);
  }

  providerMessages(address: string): Promise<ProviderMessage[]> {
    return call('GET', this.path(`/inboxes/${encodeURIComponent(address)}/messages`));
  }

  /** What the email services asked the other Macro services. */
  serviceRequests(): Promise<ServiceRequest[]> {
    return call('GET', this.path('/service-requests'));
  }

  runScheduledSweep(): Promise<void> {
    return call('POST', this.path('/scheduled-sweep'));
  }

  /** Ends the stack. Rejects when a service died or panicked. */
  finish(): Promise<void> {
    return call('DELETE', this.path(''));
  }
}
