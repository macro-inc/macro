import type { FetchWithTokenErrorCode } from '@core/util/fetchWithToken';
import type { ResultError } from '@core/util/result';
import { emailClient } from '@service-email/client';
import { ImapConnectionErrorCode } from '@service-email/generated/schemas/imapConnectionErrorCode';

const refusalCodes = Object.values(ImapConnectionErrorCode);

export function imapRefusalCode(
  errors: readonly ResultError<
    FetchWithTokenErrorCode | ImapConnectionErrorCode
  >[]
) {
  return refusalCodes.find((code) =>
    errors.some((error) => error.code === code)
  );
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
