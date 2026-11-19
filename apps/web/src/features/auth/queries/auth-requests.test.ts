import {
  createSignInAttempt,
  rememberSignInAttempt,
} from '@core/auth/sign-in-attempt';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionLogin = vi.hoisted(() => vi.fn());
vi.mock('@service-auth/client', () => ({
  authServiceClient: { sessionLogin },
}));

import { exchangeSessionCode } from './auth-requests';

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  sessionLogin.mockResolvedValue(ok(undefined));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// Anything can open the desktop app's `macro:///login?token=...` link, so a
// code this device did not ask for would sign the app into someone else's
// account.
describe('exchangeSessionCode', () => {
  it('never redeems a code that names no sign-in started here', async () => {
    expect(await exchangeSessionCode('foreign-code', undefined)).toBe(false);
    expect(sessionLogin).not.toHaveBeenCalled();
  });

  it('never redeems a code that names an attempt this device does not hold', async () => {
    rememberSignInAttempt(await createSignInAttempt());

    expect(await exchangeSessionCode('foreign-code', crypto.randomUUID())).toBe(
      false
    );
    expect(sessionLogin).not.toHaveBeenCalled();
  });

  it('redeems the code of a pending attempt with its verifier, once', async () => {
    const attempt = await createSignInAttempt();
    rememberSignInAttempt(attempt);

    expect(await exchangeSessionCode('session-code', attempt.id)).toBe(true);
    expect(sessionLogin).toHaveBeenCalledExactlyOnceWith({
      session_code: 'session-code',
      code_verifier: attempt.verifier,
    });

    // The attempt answered its callback; a second link naming it is refused.
    expect(await exchangeSessionCode('another-code', attempt.id)).toBe(false);
    expect(sessionLogin).toHaveBeenCalledOnce();
  });

  // Reopening a callback after a failed redemption, or after a sign-out that
  // came meanwhile, must not sign in: a failure asks for a new sign-in.
  it.each([
    ['the server failed', 'SERVER_ERROR'],
    ['the request never arrived', 'NETWORK_ERROR'],
    ['the server refused the code', 'HTTP_ERROR'],
  ])('spends the attempt when %s', async (_case, code) => {
    const attempt = await createSignInAttempt();
    rememberSignInAttempt(attempt);
    sessionLogin.mockResolvedValueOnce(err([{ code, message: 'failed' }]));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await exchangeSessionCode('session-code', attempt.id)).toBe(false);
    expect(await exchangeSessionCode('session-code', attempt.id)).toBe(false);
    expect(sessionLogin).toHaveBeenCalledOnce();
  });
});
