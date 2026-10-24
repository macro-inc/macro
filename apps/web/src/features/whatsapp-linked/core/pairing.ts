import { match, P } from 'ts-pattern';

/** One step of linking WhatsApp as a device, as the pairing dialog shows it. */
export type PairingStep =
  | { kind: 'preparing' }
  | { kind: 'scan'; qr: string }
  | { kind: 'code'; code: string }
  /** WhatsApp's WebAuthn request options, for the desktop authenticator only. */
  | { kind: 'passkey'; challenge: PasskeyChallenge | undefined }
  | { kind: 'connected' }
  | { kind: 'expired' }
  | { kind: 'cancelled' }
  | { kind: 'failed' };

/** WhatsApp's WebAuthn request options, passed through untouched. */
export type PasskeyChallenge = { [key: string]: unknown };

/** The pairing transaction's state, as DSS reports it. */
export type PairingState =
  | 'waiting'
  | 'qr'
  | 'passkey'
  | 'success'
  | 'expired'
  | 'cancelled'
  | 'failed';

/** What the dialog shows: a QR to scan, a code to type on the phone, or an outcome. */
export function pairingStep(state: {
  state: PairingState;
  qr?: string | null;
  code?: string | null;
  challenge?: PasskeyChallenge | null;
}): PairingStep {
  return match(state)
    .with({ state: 'waiting' }, () => ({ kind: 'preparing' as const }))
    .with({ state: 'qr', qr: P.string.minLength(1) }, ({ qr }) => ({
      kind: 'scan' as const,
      qr,
    }))
    .with({ state: 'qr', code: P.string.minLength(1) }, ({ code }) => ({
      kind: 'code' as const,
      code,
    }))
    .with({ state: 'qr' }, () => ({ kind: 'preparing' as const }))
    .with({ state: 'passkey' }, ({ challenge }) => ({
      kind: 'passkey' as const,
      challenge: challenge ?? undefined,
    }))
    .with({ state: 'success' }, () => ({
      kind: 'connected' as const,
    }))
    .with({ state: 'expired' }, () => ({ kind: 'expired' as const }))
    .with({ state: 'cancelled' }, () => ({ kind: 'cancelled' as const }))
    .with({ state: 'failed' }, () => ({ kind: 'failed' as const }))
    .exhaustive();
}

/** Whole seconds left before `expiresAt`, never negative. */
export function secondsLeft(expiresAt: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
}

/** `52` → `0:52`, `125` → `2:05`. */
export function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}
