export const MACRO_EMAIL_SIGNATURE = '-- Sent with Macro';

export const MAX_ATTACHMENTS_BYTES_SIZE = 18_000_000;
// Raw bytes the provider will still deliver once base64 adds about a third:
// Gmail caps a message's attachments at 25 MB; Exchange Online sends at most
// 35 MB by default and Outlook.com attachments stop at 25 MB. Graph accepts
// uploads up to 150 MB, but the mailbox bounces anything over its send size.
export function attachmentLimitBytes(provider?: 'GMAIL' | 'OUTLOOK'): number {
  return provider === 'OUTLOOK' ? 25_000_000 : MAX_ATTACHMENTS_BYTES_SIZE;
}

// Stable id for the compose "To" input so the create gesture can focus it
// synchronously on iOS (the virtual keyboard only opens within a user gesture).
export const EMAIL_COMPOSE_TO_INPUT_ID = 'email-compose-to-input';
