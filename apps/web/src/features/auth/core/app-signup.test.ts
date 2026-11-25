import { describe, expect, it } from 'vitest';
import {
  APP_SIGNUP_MAX_AGE_MS,
  APP_SIGNUP_MAX_PENDING,
  appSignupUrl,
  base64Url,
  type PendingAppSignup,
  parsePendingAppSignups,
  withPendingAppSignup,
} from './app-signup';

const REQUEST = {
  challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  handoffId: '01938f2e-7c4a-7b3e-9a51-2f6d8c0e4b17',
};

describe('appSignupUrl', () => {
  it('opens production sign-up on www, which the app does not claim as its own link', () => {
    const url = new URL(appSignupUrl('https://macro.com', REQUEST));
    expect(url.origin).toBe('https://www.macro.com');
    expect(url.pathname).toBe('/app/signup');
    expect(url.searchParams.get('app_challenge')).toBe(REQUEST.challenge);
    expect(url.searchParams.get('app_handoff')).toBe(REQUEST.handoffId);
  });

  it('opens other origins as they are', () => {
    expect(new URL(appSignupUrl('https://dev.macro.com', REQUEST)).origin).toBe(
      'https://dev.macro.com'
    );
  });
});

describe('base64Url', () => {
  it('writes unpadded base64url', () => {
    expect(base64Url(new Uint8Array([0xfb, 0xff, 0xfe]))).toBe('-__-');
    expect(base64Url(new Uint8Array([0x61]))).toBe('YQ');
    expect(base64Url(new Uint8Array(32))).toHaveLength(43);
  });
});

const signup = (startedAt: number, n = 0): PendingAppSignup => ({
  handoffId: `01938f2e-7c4a-7b3e-9a51-2f6d8c0e4b${String(10 + n)}`,
  verifier: 'a'.repeat(43),
  startedAt,
});

describe('pending sign-ups', () => {
  const NOW = 1_800_000_000_000;

  it('drops expired and malformed entries', () => {
    const fresh = signup(NOW - APP_SIGNUP_MAX_AGE_MS);
    const stale = signup(NOW - APP_SIGNUP_MAX_AGE_MS - 1, 1);
    expect(parsePendingAppSignups(JSON.stringify([stale, fresh]), NOW)).toEqual(
      [fresh]
    );
    expect(parsePendingAppSignups('[{"verifier":"short"}]', NOW)).toEqual([]);
    expect(parsePendingAppSignups('nope', NOW)).toEqual([]);
    expect(parsePendingAppSignups(null, NOW)).toEqual([]);
  });

  it('keeps only the newest few', () => {
    let pending: PendingAppSignup[] = [];
    for (let n = 0; n <= APP_SIGNUP_MAX_PENDING; n++)
      pending = withPendingAppSignup(pending, signup(NOW, n));
    expect(pending).toHaveLength(APP_SIGNUP_MAX_PENDING);
    expect(pending[0]).toEqual(signup(NOW, 1));
    expect(pending.at(-1)).toEqual(signup(NOW, APP_SIGNUP_MAX_PENDING));
  });
});
