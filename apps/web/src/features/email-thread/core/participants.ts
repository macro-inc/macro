import type {
  EmailContact,
  EmailMessage,
} from '@app/features/email-message/core/email-message';

/** How a person takes part in a thread; anyone who sent a message is `from`. */
export type EmailParticipantRole = 'from' | 'to' | 'cc';

export interface EmailParticipant {
  email: string;
  name?: string;
  photoUrl?: string;
  role: EmailParticipantRole;
}

/**
 * The senders and To/Cc recipients of a thread's messages, one entry per
 * address in first-seen order. A later named occurrence fills in a missing
 * name; Bcc is left out because it is not shared with the other participants.
 */
export function collectEmailParticipants(
  messages: Pick<EmailMessage, 'from' | 'to' | 'cc'>[]
): EmailParticipant[] {
  const seen = new Map<string, EmailParticipant>();
  const add = (contact: EmailContact, role: EmailParticipantRole) => {
    if (!contact.email) return;
    const existing = seen.get(contact.email);
    const nextRole =
      existing?.role === 'from' || role === 'from'
        ? 'from'
        : (existing?.role ?? role);
    if (!existing || (!existing.name && contact.name)) {
      seen.set(contact.email, {
        email: contact.email,
        name: contact.name ?? undefined,
        photoUrl: contact.photo_url ?? existing?.photoUrl ?? undefined,
        role: nextRole,
      });
    } else if (existing.role !== nextRole) {
      seen.set(contact.email, { ...existing, role: nextRole });
    }
  };

  for (const message of messages) {
    if (message.from) add(message.from, 'from');
    for (const recipient of message.to) add(recipient, 'to');
    for (const recipient of message.cc) add(recipient, 'cc');
  }
  return Array.from(seen.values());
}
