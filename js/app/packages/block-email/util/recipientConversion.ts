import {
  type ContactInfo,
  type ExtractedContactInfo,
  emailToId,
  recipientEntityMapper,
} from '@core/user';
import type { MessageWithBodyReplyless } from '@service-email/generated/schemas';
import type { EmailRecipient } from '../component/EmailContext';

const extractedContactInfo = (contact: ContactInfo): ExtractedContactInfo => ({
  ...contact,
  id: emailToId(contact.email),
  type: 'extracted',
});

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
  return recipientEntityMapper('contact')(extractedContactInfo(contact));
};

// Note: because of the logic, this works with a reference message that is either the message being replied to, or the draft.
export const getReplyAllRecipients = (
  referenceMessage: MessageWithBodyReplyless | undefined,
  userEmail: string
): {
  to: EmailRecipient[];
  cc: EmailRecipient[];
  bcc: EmailRecipient[];
} => {
  let to: EmailRecipient[] = [];
  let cc: EmailRecipient[] = [];
  if (!referenceMessage) return { to, cc, bcc: [] };

  // If last message was from user - reply to the to recipients (cc is handled separately below)
  if (referenceMessage?.from?.email === userEmail) {
    if (referenceMessage.to && referenceMessage.to.length > 0) {
      to = referenceMessage.to.map(recipientEntityMapper('contact'));
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
  if (
    referenceMessage.cc &&
    referenceMessage.cc.filter((recipient) => recipient.email !== userEmail)
      .length > 0
  ) {
    cc = referenceMessage.cc
      .filter((recipient) => recipient.email !== userEmail)
      .map(convertContactInfoToEmailRecipient);
  }
  return { to, cc, bcc: [] };
};

export const getReplyRecipientsFromParent = (
  replyingTo: MessageWithBodyReplyless | undefined,
  userEmail: string
): {
  to: EmailRecipient[];
  cc: EmailRecipient[];
  bcc: EmailRecipient[];
} => {
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
