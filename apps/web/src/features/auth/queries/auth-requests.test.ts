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

  // The server keeps a code its own failure did not redeem, so opening the
  // callback again after an outage still signs in.
  it('keeps the attempt when the server could not redeem the code', async () => {
    const attempt = await createSignInAttempt();
    rememberSignInAttempt(attempt);
    sessionLogin.mockResolvedValueOnce(
      err([{ code: 'SERVER_ERROR', message: 'unable to refresh token' }])
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await exchangeSessionCode('session-code', attempt.id)).toBe(false);
    expect(await exchangeSessionCode('session-code', attempt.id)).toBe(true);
    expect(sessionLogin).toHaveBeenCalledTimes(2);
  });

  it('forgets the attempt when the server refused the code', async () => {
    const attempt = await createSignInAttempt();
    rememberSignInAttempt(attempt);
    sessionLogin.mockResolvedValueOnce(
      err([{ code: 'HTTP_ERROR', message: 'invalid session code' }])
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await exchangeSessionCode('session-code', attempt.id)).toBe(false);
    expect(await exchangeSessionCode('session-code', attempt.id)).toBe(false);
    expect(sessionLogin).toHaveBeenCalledOnce();
  });
});
