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
      return item.data;
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

// Note: because of the logic, this works with a reference message that is either the message being replied to, or the draft.
export const getReplyAllRecipients = (
  referenceMessage: EmailMessage | undefined,
  userEmail: string
): EmailFormRecipients => {
  if (!referenceMessage) return { to: [], cc: [], bcc: [] };
  let to: EmailRecipient[] = [];

  // If last message was from user - reply to the to recipients (cc is handled separately below)
  if (referenceMessage?.from?.email === userEmail) {
    if (referenceMessage.to && referenceMessage.to.length > 0) {
      to = referenceMessage.to.map(convertContactInfoToEmailRecipient);
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
        recipient.email !== userEmail && recipient.email !== sender.email
    );
    to = [sender, ...otherRecipients].map(convertContactInfoToEmailRecipient);
  }
  const cc = (referenceMessage.cc ?? [])
    .filter((recipient) => recipient.email !== userEmail)
    .map(convertContactInfoToEmailRecipient);
  return { to, cc, bcc: [] };
};

export const getReplyRecipientsFromParent = (
  replyingTo: EmailMessage | undefined,
  userEmail: string
): EmailFormRecipients => {
  if (!replyingTo) return { to: [], cc: [], bcc: [] };
  // If last message was from user, reply === replyAll
  if (replyingTo?.from?.email === userEmail) {
    return getReplyAllRecipients(replyingTo, userEmail);
  } else {
    // Last message was NOT the user - reply to the sender
    const sender: ContactInfo = replyingTo.from ?? { email: '' };
    return {
      to: [convertContactInfoToEmailRecipient(sender)],
      cc: [],
      bcc: [],
    };
  }
};
