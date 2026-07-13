import type { EmailRecipient } from '@block-email/component/EmailContext';
import { convertContactInfoToEmailRecipient } from '@block-email/util/recipientConversion';
import type { UserMentionRecord } from '@core/component/LexicalMarkdown/utils/mentionsUtils';
import { toast } from '@core/component/Toast/Toast';

export function addUserMentionToCc(params: {
  mention: UserMentionRecord;
  recipientOptions: EmailRecipient[];
  toRecipients: EmailRecipient[];
  ccRecipients: EmailRecipient[];
  bccRecipients: EmailRecipient[];
  setCc: (next: EmailRecipient[]) => void;
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
  toast.success(`${mentionEmail} added to CC`);
}
