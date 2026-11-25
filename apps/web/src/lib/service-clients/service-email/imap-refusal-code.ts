import { ImapConnectionErrorCode } from './generated/schemas/imapConnectionErrorCode';

const knownCodes = Object.values(ImapConnectionErrorCode);

export function isImapRefusalCode(
  code: unknown
): code is ImapConnectionErrorCode {
  return knownCodes.some((known) => known === code);
}
