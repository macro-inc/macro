import { isPlatform, isTauri } from '@core/util/platform';
import { Channel, invoke } from '@tauri-apps/api/core';
import { ResultAsync } from 'neverthrow';
import { match, P } from 'ts-pattern';
import type {
  PasskeyEvent,
  PasskeyFailure,
} from '../context/whatsapp-linked-context';
import type { PasskeyChallenge } from '../core/pairing';

/** Whether this is Macro desktop, the only place a passkey can be answered. */
export function canAuthenticatePasskey(): boolean {
  return isTauri() && isPlatform('desktop');
}

/** The desktop app's errors (`whatsapp_passkey::AuthenticationError`) in words. */
function passkeyFailure(error: unknown): PasskeyFailure {
  const message = match(error)
    .with(
      'invalid',
      () =>
        'This connection request is no longer valid. Start connecting again.'
    )
    .with(
      'unverified',
      () => 'Your phone did not verify you. Unlock your phone and try again.'
    )
    // Desktop builds from before the command answer "command ... not found".
    .with(
      P.string.regex(/not found/i),
      () => 'Update Macro desktop to confirm WhatsApp passkeys, then try again.'
    )
    .with(
      P.union('unavailable', 'unsupported'),
      () =>
        'WhatsApp authentication was cancelled or unavailable. Check Bluetooth, keep your phone nearby, and try again.'
    )
    .otherwise(
      () =>
        'WhatsApp authentication could not finish. Check Bluetooth and try again.'
    );
  return { kind: 'passkey-failed', message };
}

/**
 * Signs WhatsApp's passkey challenge with the desktop authenticator (caBLE or
 * the OS WebAuthn API). The assertion only leaves through the passkey route.
 */
export function authenticateWhatsAppPasskey(
  pairingId: string,
  challenge: PasskeyChallenge,
  onEvent: (event: PasskeyEvent) => void
): ResultAsync<Record<string, unknown>, PasskeyFailure> {
  const events = new Channel<PasskeyEvent>();
  events.onmessage = onEvent;
  return ResultAsync.fromPromise(
    invoke<Record<string, unknown>>('whatsapp_passkey_authenticate', {
      pairingId,
      challenge,
      onEvent: events,
    }),
    passkeyFailure
  );
}

/** A deep link that opens this pairing in Macro desktop, by id only. */
export function desktopPairingUrl(pairingId: string): string {
  return `macro:///external?whatsappPairing=${encodeURIComponent(pairingId)}`;
}
