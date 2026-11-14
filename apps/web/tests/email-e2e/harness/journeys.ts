// What the journeys share: mailboxes for the people mail goes to, and mail
// read the way its recipient's client reads it, on either provider.

import { expect } from '@playwright/test';
import type { Mailbox } from './fixtures';
import { deliverLabelled } from './list';
import { gmailRawMessage, header } from './provider';
import { htmlBody } from './send';
import type { Mail, Provider } from './stack';

/** The emulator of a provider, in this test's stack. */
export function emulatorUrl(mailbox: Mailbox, provider: Provider): string {
  return provider === 'GMAIL'
    ? mailbox.stack.info.gmailUrl
    : mailbox.stack.info.outlookUrl;
}

/** Opens a mailbox at the provider for someone mail is sent to. */
export async function addMailbox(
  mailbox: Mailbox,
  email: string,
  provider: Provider = mailbox.inbox.provider
): Promise<void> {
  const response = await fetch(
    `${emulatorUrl(mailbox, provider)}/_emulator/mailboxes`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    }
  );
  if (!response.ok) {
    throw new Error(
      `no mailbox ${email}: ${response.status} ${await response.text()}`
    );
  }
}

async function token(
  mailbox: Mailbox,
  provider: Provider,
  email: string
): Promise<string> {
  const response = await fetch(
    `${emulatorUrl(mailbox, provider)}/_emulator/mailboxes/${encodeURIComponent(email)}/access-tokens`,
    { method: 'POST' }
  );
  if (!response.ok) throw new Error(`no token for ${email}`);
  return ((await response.json()) as { access_token: string }).access_token;
}

/** A message as its mailbox's owner reads it. */
export type ReadMessage = {
  id: string;
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  /** The HTML body, or the text one when there is no HTML. */
  html: string;
  /** The names of its attachments. */
  attachments: string[];
};

function addresses(value: string | undefined): string[] {
  if (!value) return [];
  return [...value.matchAll(/[\w.+-]+@[\w.-]+/g)].map((match) =>
    match[0].toLowerCase()
  );
}

function attachmentNames(raw: string): string[] {
  return [
    ...raw.matchAll(
      /content-disposition:\s*attachment;[^\n]*?\s*filename="?([^"\r\n;]+)"?/gi
    ),
  ].map((match) => match[1]);
}

async function readGmail(
  mailbox: Mailbox,
  email: string
): Promise<ReadMessage[]> {
  const listed = await fetch(
    `${mailbox.stack.info.gmailUrl}/_emulator/mailboxes/${encodeURIComponent(email)}/messages`
  );
  if (!listed.ok) throw new Error(`no messages for ${email}`);
  const summaries = (await listed.json()) as {
    id: string;
    labels: string[];
  }[];
  const messages: ReadMessage[] = [];
  for (const summary of summaries) {
    if (summary.labels.includes('DRAFT')) continue;
    const raw = await gmailRawMessage(mailbox.stack.info, email, summary.id);
    let html: string;
    try {
      html = htmlBody(raw);
    } catch {
      html = raw
        .split(/\r?\n\r?\n/)
        .slice(1)
        .join('\n\n');
    }
    messages.push({
      id: summary.id,
      subject: header(raw, 'Subject') ?? '',
      from: addresses(header(raw, 'From'))[0] ?? '',
      to: addresses(header(raw, 'To')),
      cc: addresses(header(raw, 'Cc')),
      bcc: addresses(header(raw, 'Bcc')),
      html,
      attachments: attachmentNames(raw),
    });
  }
  return messages;
}

type GraphAddress = { emailAddress: { address: string } };

async function readOutlook(
  mailbox: Mailbox,
  email: string
): Promise<ReadMessage[]> {
  const base = mailbox.stack.info.outlookUrl;
  const listed = await fetch(
    `${base}/_emulator/mailboxes/${encodeURIComponent(email)}/messages`
  );
  if (!listed.ok) throw new Error(`no messages for ${email}`);
  const summaries = (await listed.json()) as {
    id: string;
    is_draft: boolean;
    attachments: string[];
  }[];
  const bearer = await token(mailbox, 'OUTLOOK', email);
  const messages: ReadMessage[] = [];
  for (const summary of summaries) {
    if (summary.is_draft) continue;
    const response = await fetch(
      `${base}/v1.0/users/${encodeURIComponent(email)}/messages/${summary.id}`,
      { headers: { authorization: `Bearer ${bearer}` } }
    );
    if (!response.ok) throw new Error(`no Outlook message ${summary.id}`);
    const message = (await response.json()) as {
      subject: string;
      from?: GraphAddress;
      toRecipients: GraphAddress[];
      ccRecipients: GraphAddress[];
      bccRecipients: GraphAddress[];
      body: { content: string };
    };
    const list = (recipients: GraphAddress[]) =>
      recipients.map((recipient) =>
        recipient.emailAddress.address.toLowerCase()
      );
    messages.push({
      id: summary.id,
      subject: message.subject,
      from: message.from?.emailAddress.address.toLowerCase() ?? '',
      to: list(message.toRecipients),
      cc: list(message.ccRecipients),
      bcc: list(message.bccRecipients),
      html: message.body.content,
      attachments: summary.attachments,
    });
  }
  return messages;
}

/**
 * Every message a mailbox at the provider holds, drafts left out, read
 * through the provider's own API.
 */
export function readMailbox(
  mailbox: Mailbox,
  email: string,
  provider: Provider = mailbox.inbox.provider
): Promise<ReadMessage[]> {
  return provider === 'GMAIL'
    ? readGmail(mailbox, email)
    : readOutlook(mailbox, email);
}

/** The name the provider gives the folder of sent mail. */
export function sentFolder(provider: Provider): string {
  return provider === 'GMAIL' ? 'SENT' : 'Sent Items';
}

/** The name the provider gives the trash. */
export function trashFolder(provider: Provider): string {
  return provider === 'GMAIL' ? 'TRASH' : 'Deleted Items';
}

/** The name the provider gives spam. */
export function spamFolder(provider: Provider): string {
  return provider === 'GMAIL' ? 'SPAM' : 'Junk Email';
}

/** Puts a message in the inbox's spam at the provider, as its filter would. */
export async function deliverToSpam(
  mailbox: Mailbox,
  mail: Mail
): Promise<void> {
  if (mailbox.inbox.provider === 'GMAIL') {
    await deliverLabelled(mailbox, mail, ['SPAM', 'UNREAD']);
    return;
  }
  const delivered = await mailbox.deliver(mail);
  const response = await fetch(
    `${mailbox.stack.info.outlookUrl}/_emulator/mailboxes/${encodeURIComponent(mailbox.inbox.email)}/messages/${delivered.id}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ folder: 'junkemail' }),
    }
  );
  if (!response.ok)
    throw new Error(`Outlook refused the move: ${response.status}`);
}

/**
 * Waits until Macro lists a thread with this subject in a view (`spam`,
 * `trash`) and answers its id.
 */
export async function syncedInView(
  mailbox: Mailbox,
  view: string,
  subject: string
): Promise<string> {
  let id = '';
  await expect
    .poll(
      async () => {
        const response = await mailbox.api(
          `/email/email/threads/previews/cursor/${view}?limit=100`
        );
        const { items } = (await response.json()) as {
          items: { id: string; name: string }[];
        };
        id = items.find((item) => item.name === subject)?.id ?? '';
        return id;
      },
      { message: `Macro never listed "${subject}" in ${view}`, timeout: 60_000 }
    )
    .not.toBe('');
  return id;
}
