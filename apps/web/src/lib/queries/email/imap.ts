import type { FetchWithTokenErrorCode } from '@core/util/fetchWithToken';
import type { ResultError } from '@core/util/result';
import { emailClient } from '@service-email/client';
import type { ImapConnectionErrorCode } from '@service-email/generated/schemas/imapConnectionErrorCode';
import { isImapRefusalCode } from '@service-email/imap-refusal-code';

export function imapRefusalCode(
  errors: readonly ResultError<
    FetchWithTokenErrorCode | ImapConnectionErrorCode
  >[]
) {
  return errors.map(({ code }) => code).find(isImapRefusalCode);
}

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
