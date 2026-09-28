import type { EmailMessage } from '@app/features/email-message/core/email-message';

/** Personal messages get theme-adapted rendering (vs the forced white panel
 * for table-layout marketing emails). Mirrored between the message view and
 * the compose quote. */
export function isPersonalMessage(
  message: EmailMessage,
  userEmail: string | undefined,
  personalSenders: Set<string>
): boolean {
  const senderEmail = message.from?.email?.toLowerCase();
  return (
    (senderEmail !== undefined && senderEmail === userEmail?.toLowerCase()) ||
    message.labels.some((l) => l.name === 'CATEGORY_PERSONAL') ||
    (senderEmail !== undefined && personalSenders.has(senderEmail))
  );
}
