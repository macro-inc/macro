import { Channel, invoke } from '@tauri-apps/api/core';
export type AuthenticationEvent =
  | { type: 'qr'; value: string }
  | { type: 'touch' | 'processing' | 'dismiss' };
/** Narrow native authentication capability; no hosted-session key reaches desktop. */
export function authenticateWhatsApp(
  challenge: unknown,
  onEvent: (event: AuthenticationEvent) => void
) {
  const channel = new Channel<AuthenticationEvent>();
  channel.onmessage = onEvent;
  return invoke<unknown>('authenticate_whatsapp_passkey', {
    challenge,
    onEvent: channel,
  });
}
