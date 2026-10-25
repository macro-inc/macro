import type {
  EmailFormRecipients,
  EmailRecipient,
} from '@app/features/email-compose/core/email-recipient';
import type { EmailMessage } from '@app/features/email-message/core/email-message';
import type { EmailContact as ContactInfo } from '../../email-message/core/email-message';
export const convertEmailRecipientToContactInfo = (
  item: EmailRecipient
): ContactInfo => {
  switch (item.kind) {
    case 'user':
      return { email: item.data.email, name: item.data.name };
    case 'contact':
      // Form contacts can be Solid store proxies. Persistence needs an owned,
      // cloneable snapshot rather than a live reference into the form.
      return { ...item.data };
    case 'custom':
      return { email: item.data.email };
  }
};

export const convertContactInfoToEmailRecipient = (
  contact: ContactInfo
): EmailRecipient => {
  const id = `macro|${contact.email}`;
  return { kind: 'contact', id, data: { ...contact, id, type: 'extracted' } };
};

// Senders of delivery failure reports; a reply there reaches no one on the
// thread. Kept narrow on purpose: a noreply@ address can still be a person's.
const BOUNCE_SENDER =
  /^(mailer-daemon|postmaster|microsoftexchange[0-9a-f]{32})@/i;
const isBounceSender = (email: string | undefined) =>
  !!email && BOUNCE_SENDER.test(email);

// Note: because of the logic, this works with a reference message that is either the message being replied to, or the draft.
export const getReplyAllRecipients = (
  referenceMessage: EmailMessage | undefined,
  userEmail: string,
  ownAddresses: readonly string[] = []
): EmailFormRecipients => {
  if (!referenceMessage) return { to: [], cc: [], bcc: [] };
  const self = new Set(
    [userEmail, ...ownAddresses].map((email) => email.toLowerCase())
  );
  const isSelf = (email: string | undefined) =>
    !!email && self.has(email.toLowerCase());
  const replyable = (contact: ContactInfo) =>
    !isSelf(contact.email) && !isBounceSender(contact.email);
  let to: EmailRecipient[] = [];

  // If last message was from user - reply to the to recipients (cc is handled separately below)
  if (isSelf(referenceMessage.from?.email)) {
    if (referenceMessage.to && referenceMessage.to.length > 0) {
      to = referenceMessage.to
        .filter(replyable)
        .map(convertContactInfoToEmailRecipient);
    }
    // Otherwise keep existing recipients
  } else {
    // Last message was NOT the user - reply to the sender
    // We need to include in the TO field both the sender of the last message, and the other recipients of the message we are replying to, NOT including the user.
    const sender: ContactInfo = referenceMessage.from ?? {
      email: '',
    };
    const otherRecipients = referenceMessage.to.filter(
      (recipient) =>
        recipient.email.toLowerCase() !== sender.email.toLowerCase()
    );
    to = [sender, ...otherRecipients]
      .filter(replyable)
      .map(convertContactInfoToEmailRecipient);
  }
  const cc = (referenceMessage.cc ?? [])
    .filter(replyable)
    .map(convertContactInfoToEmailRecipient);
  return { to, cc, bcc: [] };
};

export const getReplyRecipientsFromParent = (
  replyingTo: EmailMessage | undefined,
  userEmail: string,
  ownAddresses: readonly string[] = []
): EmailFormRecipients => {
  if (!replyingTo) return { to: [], cc: [], bcc: [] };
  // If last message was from any identity on this inbox, reply === replyAll.
  if (
    [userEmail, ...ownAddresses].some(
      (email) => email.toLowerCase() === replyingTo.from?.email.toLowerCase()
    )
  ) {
    return getReplyAllRecipients(replyingTo, userEmail, ownAddresses);
  } else {
    // Last message was NOT the user - reply to the sender
    const sender: ContactInfo = replyingTo.from ?? { email: '' };
    return {
      to: isBounceSender(sender.email)
        ? []
        : [convertContactInfoToEmailRecipient(sender)],
      cc: [],
      bcc: [],
    };
  }
};
