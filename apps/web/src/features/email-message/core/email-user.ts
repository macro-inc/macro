import type { EmailMessage } from '@app/features/email-message/core/email-message';

import { getFirstName } from './name';

export function isViewerAddress(
  address: string | null | undefined,
  viewerEmail: string | undefined
): boolean {
  if (!address || !viewerEmail) return false;
  return address.toLowerCase() === viewerEmail.toLowerCase();
}

/**
 * Get the sender display name, showing "Me" for the current user
 */
export function getSenderDisplayName(
  message: EmailMessage,
  currentUserEmail?: string
): string {
  if (isViewerAddress(message.from?.email, currentUserEmail)) {
    return 'Me';
  }
  const from = message.from;
  if (!from) return 'Unknown';
  if (from.name) {
    return getFirstName(from.name);
  }
  return from.email ?? 'Unknown';
}

/**
 * Convert the message sender email to a macro id for user tooling.
 */
export function getSenderMacroId(message: EmailMessage): string | undefined {
  const senderEmail = message.from?.email;
  return senderEmail?.includes('@') ? `macro|${senderEmail}` : undefined;
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
  if (isViewerAddress(recipient.email, currentUserEmail)) return 'Me';
  return recipient.name
    ? getFirstName(recipient.name)
    : (recipient.email?.split('@')[0] ?? '');
}
