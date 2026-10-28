import { describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({
  invoke,
  Channel: class {
    onmessage: ((event: unknown) => void) | undefined;
  },
}));

import { authenticateWhatsAppPasskey } from './authenticator';

describe('authenticateWhatsAppPasskey', () => {
  it('passes the challenge verbatim and returns the assertion', async () => {
    invoke.mockResolvedValueOnce({ id: 'credential', type: 'public-key' });
    const result = await authenticateWhatsAppPasskey(
      'pairing-1',
      { challenge: 'abc', rpId: 'whatsapp.com' },
      vi.fn()
    );
    expect(result._unsafeUnwrap()).toEqual({
      id: 'credential',
      type: 'public-key',
    });
    expect(invoke).toHaveBeenCalledWith('whatsapp_passkey_authenticate', {
      pairingId: 'pairing-1',
      challenge: { challenge: 'abc', rpId: 'whatsapp.com' },
      onEvent: expect.anything(),
    });
  });

  it('asks for a desktop update when the command is missing', async () => {
    invoke.mockRejectedValueOnce(
      'Command whatsapp_passkey_authenticate not found'
    );
    const result = await authenticateWhatsAppPasskey('p', {}, vi.fn());
    expect(result._unsafeUnwrapErr().message).toBe(
      'Update Macro desktop to confirm WhatsApp passkeys, then try again.'
    );
  });

  it('puts the desktop app’s error codes into words', async () => {
    invoke.mockRejectedValueOnce('unverified');
    const result = await authenticateWhatsAppPasskey('p', {}, vi.fn());
    expect(result._unsafeUnwrapErr().message).toBe(
      'Your phone did not verify you. Unlock your phone and try again.'
    );
  });
});
