import { emailClient } from '@service-email/client';

/** A message's original source (`.eml` bytes), read fresh from its provider. */
export function getEmailMessageEml(messageId: string) {
  return emailClient.getMessageEml({ message_id: messageId });
}
