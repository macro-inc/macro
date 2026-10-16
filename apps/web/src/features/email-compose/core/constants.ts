export const MACRO_EMAIL_SIGNATURE = '-- Sent with Macro';

export const MAX_ATTACHMENTS_BYTES_SIZE = 18_000_000;
export function attachmentLimitBytes(provider?: 'GMAIL' | 'OUTLOOK'): number {
  return provider === 'OUTLOOK' ? 150_000_000 : MAX_ATTACHMENTS_BYTES_SIZE;
}

// Stable id for the compose "To" input so the create gesture can focus it
// synchronously on iOS (the virtual keyboard only opens within a user gesture).
export const EMAIL_COMPOSE_TO_INPUT_ID = 'email-compose-to-input';
