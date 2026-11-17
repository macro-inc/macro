// What the owner of a mailbox does in the provider's own client (Gmail,
// Outlook) while Macro is not looking: the changes sync has to pick up.

import type { Mailbox } from './fixtures';

function mailboxUrl(mailbox: Mailbox, address: string): string {
  const base =
    mailbox.inbox.provider === 'GMAIL'
      ? mailbox.stack.info.gmailUrl
      : mailbox.stack.info.outlookUrl;
  return `${base}/_emulator/mailboxes/${encodeURIComponent(address)}`;
}

async function control(
  url: string,
  method: string,
  body?: unknown
): Promise<unknown> {
  const response = await fetch(url, {
    method,
    headers:
      body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${url} answered ${response.status}:\n${text}`);
  }
  return text ? JSON.parse(text) : undefined;
}

/** Gmail tells its watchers of a change; Outlook's emulator does by itself. */
async function announce(mailbox: Mailbox, address: string): Promise<void> {
  if (mailbox.inbox.provider !== 'GMAIL') return;
  await control(`${mailboxUrl(mailbox, address)}/push`, 'POST');
}

/** A change the owner makes to a message in the provider's own client. */
export type ProviderChange = {
  read?: boolean;
  /** Gmail's star, Outlook's flag. */
  starred?: boolean;
  /** Out of the inbox: Gmail drops `INBOX`, Outlook moves it to Archive. */
  archived?: true;
  /** To Gmail's Trash, Outlook's Deleted Items. */
  trashed?: true;
};

/** Changes a message at the provider, as its owner would there. */
export async function changeAtProvider(
  mailbox: Mailbox,
  messageId: string,
  change: ProviderChange,
  address = mailbox.inbox.email
): Promise<void> {
  const message = `${mailboxUrl(mailbox, address)}/messages/${messageId}`;
  if (mailbox.inbox.provider === 'GMAIL') {
    const add: string[] = [];
    const remove: string[] = [];
    if (change.read !== undefined) (change.read ? remove : add).push('UNREAD');
    if (change.starred !== undefined)
      (change.starred ? add : remove).push('STARRED');
    if (change.archived) remove.push('INBOX');
    if (change.trashed) {
      add.push('TRASH');
      remove.push('INBOX');
    }
    await control(`${message}/labels`, 'POST', { add, remove });
  } else {
    await control(message, 'PATCH', {
      read: change.read,
      flagged: change.starred,
      folder: change.trashed
        ? 'deleteditems'
        : change.archived
          ? 'archive'
          : undefined,
    });
  }
  await announce(mailbox, address);
}

/** Deletes a message at the provider for good, as its owner would there. */
export async function deleteAtProvider(
  mailbox: Mailbox,
  messageId: string,
  address = mailbox.inbox.email
): Promise<void> {
  await control(
    `${mailboxUrl(mailbox, address)}/messages/${messageId}`,
    'DELETE'
  );
  await announce(mailbox, address);
}

/**
 * Puts a message in the mailbox's sent mail at the provider: what sending
 * from the provider's own client leaves there.
 */
export async function sendAtProvider(
  mailbox: Mailbox,
  mail: { to: string; subject: string; text: string },
  address = mailbox.inbox.email
): Promise<void> {
  await control(`${mailboxUrl(mailbox, address)}/messages`, 'POST', {
    from: address,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    ...(mailbox.inbox.provider === 'GMAIL'
      ? { labels: ['SENT'] }
      : { folder: 'sentitems' }),
  });
  await announce(mailbox, address);
}

/** A received message with its time of arrival. */
export type DatedMail = {
  from: string;
  subject: string;
  text: string;
  /** When it arrived. Outlook keeps whole seconds. */
  date: Date;
  /** Without angle brackets. */
  messageId?: string;
  /** The `Message-ID` this replies to, which puts it in that thread. */
  inReplyTo?: string;
};

/**
 * Puts a message in the inbox at the provider as if it had arrived at
 * `date`, and answers its id there: for conversations whose order matters.
 */
export async function deliverAt(
  mailbox: Mailbox,
  mail: DatedMail,
  address = mailbox.inbox.email
): Promise<string> {
  const delivered = (await control(
    `${mailboxUrl(mailbox, address)}/messages`,
    'POST',
    {
      from: mail.from,
      subject: mail.subject,
      text: mail.text,
      date: mail.date.toISOString(),
      message_id: mail.messageId,
      in_reply_to: mail.inReplyTo,
    }
  )) as { id: string };
  await announce(mailbox, address);
  return delivered.id;
}
