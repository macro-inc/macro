import type { MessageWithBodyReplyless } from '@service-email/generated/schemas';
import { getFirstName } from './name';

/**
 * Check if a message is from the current user
 */
export function isMessageFromCurrentUser(
  message: MessageWithBodyReplyless,
  currentUserEmail?: string
): boolean {
  if (!currentUserEmail) return false;
  const fromEmail = message.from?.email?.toLowerCase();
  const userEmail = currentUserEmail.toLowerCase();
  return fromEmail !== undefined && fromEmail === userEmail;
}

/**
 * Get the sender display name, showing "Me" for the current user
 */
export function getSenderDisplayName(
  message: MessageWithBodyReplyless,
  currentUserEmail?: string
): string {
  if (isMessageFromCurrentUser(message, currentUserEmail)) {
    return 'Me';
  }
  const from = message.from;
  if (!from) return 'Unknown';
  if (from.name) {
    return getFirstName(from.name);
  }
  return from.email ?? 'Unknown';
}

interface Recipient {
  name?: string | null;
  email?: string | null;
}

/**
 * Get recipient display name, showing "Me" for the current user
 */
export function getRecipientDisplayName(
  recipient: Recipient,
  currentUserEmail?: string
): string {
  if (recipient.email === currentUserEmail) return 'Me';
  return recipient.name
    ? getFirstName(recipient.name)
    : (recipient.email?.split('@')[0] ?? '');
}
