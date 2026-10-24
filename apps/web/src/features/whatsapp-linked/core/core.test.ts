import { describe, expect, it } from 'vitest';
import { accountStatus, phoneFromJid } from './account';
import { formatCountdown, pairingStep, secondsLeft } from './pairing';

describe('pairingStep', () => {
  it('shows the QR only once the server has one', () => {
    expect(pairingStep({ state: 'qr', qr: null })).toEqual({
      kind: 'preparing',
    });
    expect(pairingStep({ state: 'qr', qr: '2@abc,def' })).toEqual({
      kind: 'scan',
      qr: '2@abc,def',
    });
    expect(pairingStep({ state: 'qr', code: 'ABCD-1234' })).toEqual({
      kind: 'code',
      code: 'ABCD-1234',
    });
  });

  it('carries WhatsApp’s passkey challenge for the desktop authenticator', () => {
    expect(
      pairingStep({ state: 'passkey', challenge: { rpId: 'whatsapp.com' } })
    ).toEqual({ kind: 'passkey', challenge: { rpId: 'whatsapp.com' } });
    expect(pairingStep({ state: 'passkey' })).toEqual({
      kind: 'passkey',
      challenge: undefined,
    });
  });

  it('reads the terminal states', () => {
    expect(pairingStep({ state: 'success' })).toEqual({ kind: 'connected' });
    expect(pairingStep({ state: 'expired' })).toEqual({ kind: 'expired' });
    expect(pairingStep({ state: 'cancelled' })).toEqual({ kind: 'cancelled' });
    expect(pairingStep({ state: 'failed' })).toEqual({ kind: 'failed' });
  });
});

describe('countdown', () => {
  it('rounds up to whole seconds and stops at zero', () => {
    const deadline = '2026-10-20T12:00:52.000Z';
    expect(secondsLeft(deadline, Date.parse('2026-10-20T12:00:00.500Z'))).toBe(
      52
    );
    expect(secondsLeft(deadline, Date.parse('2026-10-20T12:01:00.000Z'))).toBe(
      0
    );
    expect(formatCountdown(52)).toBe('0:52');
    expect(formatCountdown(125)).toBe('2:05');
  });
});

describe('account', () => {
  it('reads the phone number from a user JID with a device suffix', () => {
    expect(phoneFromJid('14155550142:7@s.whatsapp.net')).toBe('+14155550142');
    expect(phoneFromJid('14155550142@s.whatsapp.net')).toBe('+14155550142');
    expect(phoneFromJid('81234567@lid')).toBeUndefined();
  });

  it('treats a signed-out device as needing a reconnect', () => {
    expect(
      accountStatus({ generation: 2, phone: undefined, health: 'logged_out' })
    ).toEqual({ kind: 'not-connected', reconnect: true });
    expect(accountStatus(null)).toEqual({
      kind: 'not-connected',
      reconnect: false,
    });
    expect(
      accountStatus({ generation: 2, phone: undefined, health: 'pairing' })
    ).toEqual({ kind: 'not-connected', reconnect: false });
  });
});
