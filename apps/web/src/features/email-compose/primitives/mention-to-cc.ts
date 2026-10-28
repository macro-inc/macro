import type { EmailRecipient } from '@app/features/email-compose/core/email-recipient';

import { convertContactInfoToEmailRecipient } from '../core/recipient-conversion';

export function addUserMentionToCc(params: {
  mention: { email?: string };
  recipientOptions: EmailRecipient[];
  toRecipients: EmailRecipient[];
  ccRecipients: EmailRecipient[];
  bccRecipients: EmailRecipient[];
  setCc: (next: EmailRecipient[]) => void;
  onRecipientAdded?: (email: string) => void;
}) {
  const {
    mention,
    recipientOptions,
    toRecipients,
    ccRecipients,
    bccRecipients,
    setCc,
  } = params;
  const mentionEmail = mention.email;
  if (!mentionEmail) return;

  const matches = (recipient: EmailRecipient) =>
    recipient.data.email === mentionEmail;

  if (
    toRecipients.some(matches) ||
    ccRecipients.some(matches) ||
    bccRecipients.some(matches)
  ) {
    return;
  }

  const userOption =
    recipientOptions.find(matches) ??
    convertContactInfoToEmailRecipient({ email: mentionEmail });

  setCc([...ccRecipients, userOption]);
  params.onRecipientAdded?.(mentionEmail);
}
