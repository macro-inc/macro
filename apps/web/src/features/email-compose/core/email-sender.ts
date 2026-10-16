import type { EmailMessage } from '../../email-message/core/email-message';

export type EmailSenderAddress = {
  email_address: string;
  displayName?: string;
};

export type SenderInbox = {
  id: string;
  email_address: string;
  displayName?: string;
  photo_url?: string | null;
  /** null means this inbox's provider lookup failed; undefined is not loaded. */
  sendAs?: readonly EmailSenderAddress[] | null;
};

export type FromInboxOption = EmailSenderAddress & {
  id: string;
  inboxId: string;
  photo_url?: string | null;
  isAlias: boolean;
};

export function fromInboxOptions(
  inboxes: readonly SenderInbox[]
): FromInboxOption[] {
  return [...inboxes]
    .sort((a, b) => a.email_address.localeCompare(b.email_address))
    .flatMap((inbox) => {
      const seen = new Set([inbox.email_address.toLowerCase()]);
      const aliases = [...(inbox.sendAs ?? [])]
        .sort((a, b) => a.email_address.localeCompare(b.email_address))
        .filter((alias) => {
          const address = alias.email_address.toLowerCase();
          if (seen.has(address)) return false;
          seen.add(address);
          return true;
        });
      return [
        {
          id: inbox.id,
          inboxId: inbox.id,
          email_address: inbox.email_address,
          displayName: inbox.displayName,
          photo_url: inbox.photo_url,
          isAlias: false,
        },
        ...aliases.map((alias) => ({
          ...alias,
          id: `${inbox.id}:${alias.email_address.toLowerCase()}`,
          inboxId: inbox.id,
          photo_url: inbox.photo_url,
          isAlias: true,
        })),
      ];
    });
}

/** Match only within the thread's inbox, never an unrelated connected account.
 * An outgoing message preserves its own From address. Otherwise To precedes Cc/Bcc,
 * with aliases preferred over the primary address within each recipient group. */
export function replySenderAddress(
  inbox: SenderInbox | undefined,
  message: EmailMessage | undefined
): string | undefined {
  if (!inbox) return undefined;
  const aliases = (inbox.sendAs ?? []).filter(
    (alias) =>
      alias.email_address.toLowerCase() !== inbox.email_address.toLowerCase()
  );
  const senders = [...aliases, inbox];
  const ownFrom = senders.find(
    (sender) =>
      sender.email_address.toLowerCase() === message?.from?.email.toLowerCase()
  );
  if (ownFrom) return ownFrom.email_address;
  for (const recipients of [message?.to, message?.cc, message?.bcc]) {
    const addresses = new Set(
      recipients?.map((contact) => contact.email.toLowerCase())
    );
    const match = senders.find((sender) =>
      addresses.has(sender.email_address.toLowerCase())
    );
    if (match) return match.email_address;
  }
  return inbox.email_address;
}
