import { emailClient } from '@service-email/client';

/**
 * The setup and settings dialogs own these one-shot requests. Keeping them out
 * of the query and mutation caches limits passwords and server details to the
 * open dialog. Each caller passes its cancellation signal and interaction span.
 */
export const {
  imapDiscover,
  imapConnect,
  getImapMailboxSettings,
  updateImapMailboxSettings,
} = emailClient;
