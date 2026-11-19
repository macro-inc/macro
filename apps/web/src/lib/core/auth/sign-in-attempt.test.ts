import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSignInAttempt,
  forgetSignInAttempts,
  rememberSignInAttempt,
  signInChallenge,
  takeSignInAttempt,
  withSignInAttempt,
} from './sign-in-attempt';

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createSignInAttempt', () => {
  it('derives the S256 challenge of RFC 7636 appendix B', async () => {
    expect(
      await signInChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')
    ).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('keeps a fresh 43-character verifier and sends only its challenge', async () => {
    const attempt = await createSignInAttempt();
    expect(attempt.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(attempt.challenge).toBe(await signInChallenge(attempt.verifier));
    expect(attempt.challenge).not.toBe(attempt.verifier);
    expect((await createSignInAttempt()).verifier).not.toBe(attempt.verifier);
  });
});

describe('pending attempts', () => {
  it('answer one callback each', async () => {
    const attempt = await createSignInAttempt();
    rememberSignInAttempt(attempt);
    expect(takeSignInAttempt(attempt.id)).toBe(attempt.verifier);
    expect(takeSignInAttempt(attempt.id)).toBeUndefined();
  });

  it('answer nothing for a callback that names none or another', async () => {
    rememberSignInAttempt(await createSignInAttempt());
    expect(takeSignInAttempt(undefined)).toBeUndefined();
    expect(takeSignInAttempt(crypto.randomUUID())).toBeUndefined();
  });

  it('expire after fifteen minutes', async () => {
    const attempt = await createSignInAttempt();
    rememberSignInAttempt(attempt);
    vi.advanceTimersByTime(15 * 60 * 1000);
    expect(takeSignInAttempt(attempt.id)).toBeUndefined();
  });

  it('keep the five newest', async () => {
    const attempts = [];
    for (let i = 0; i < 6; i++) {
      const attempt = await createSignInAttempt();
      rememberSignInAttempt(attempt);
      attempts.push(attempt);
    }
    expect(takeSignInAttempt(attempts[0].id)).toBeUndefined();
    for (const attempt of attempts.slice(1)) {
      expect(takeSignInAttempt(attempt.id)).toBe(attempt.verifier);
    }
  });

  it('are all forgotten on sign-out', async () => {
    const attempt = await createSignInAttempt();
    rememberSignInAttempt(attempt);
    forgetSignInAttempts();
    expect(takeSignInAttempt(attempt.id)).toBeUndefined();
  });

  it('ignore storage that is not theirs', () => {
    localStorage.setItem('pendingSignInAttempts', '{"id":"x"}');
    expect(takeSignInAttempt('x')).toBeUndefined();
    localStorage.setItem('pendingSignInAttempts', 'not json');
    expect(takeSignInAttempt('x')).toBeUndefined();
  });
});

describe('withSignInAttempt', () => {
  it('names the attempt and keeps the query it had byte for byte', async () => {
    const attempt = await createSignInAttempt();
    expect(withSignInAttempt('macro:///login', attempt)).toBe(
      `macro:///login?sign_in_attempt=${attempt.id}`
    );
    expect(
      withSignInAttempt('macro:///login?redirect=%252Fteam-invite', attempt)
    ).toBe(
      `macro:///login?redirect=%252Fteam-invite&sign_in_attempt=${attempt.id}`
    );
    expect(
      withSignInAttempt('https://macro.test/app/login?a=b%20c#top', attempt)
    ).toBe(
      `https://macro.test/app/login?a=b%20c&sign_in_attempt=${attempt.id}#top`
    );
  });

  // Signing in again from a return that failed must not carry its code or
  // attempt into the new sign-in's return URL.
  it('drops the code and attempt an earlier return left', async () => {
    const attempt = await createSignInAttempt();
    expect(
      withSignInAttempt(
        'https://macro.test/app/login?token=old-code&a=b%20c&sign_in_attempt=old&tokens=1',
        attempt
      )
    ).toBe(
      `https://macro.test/app/login?a=b%20c&tokens=1&sign_in_attempt=${attempt.id}`
    );
  });

  // The page reading the return decodes names, so `%74oken` is a `token`.
  it('drops them under any spelling of their names', async () => {
    const attempt = await createSignInAttempt();
    expect(
      withSignInAttempt(
        'macro:///login?%74oken=old-code&sign%5Fin%5F%61ttempt=old&redirect=%252Fx',
        attempt
      )
    ).toBe(`macro:///login?redirect=%252Fx&sign_in_attempt=${attempt.id}`);
  });

  // `?token` and `%2574oken` (`%74oken` to that page) name other fields.
  it('keeps fields that only look like them', async () => {
    const attempt = await createSignInAttempt();
    expect(
      withSignInAttempt(
        'https://macro.test/app/login?x=1&?token=shown&token_hint=a&%2574oken=b',
        attempt
      )
    ).toBe(
      `https://macro.test/app/login?x=1&?token=shown&token_hint=a&%2574oken=b&sign_in_attempt=${attempt.id}`
    );
  });
});

describe('pending attempts without storage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('report that one could not be kept', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(rememberSignInAttempt(await createSignInAttempt())).toBe(false);
  });

  it('answer no callback when the attempt cannot be forgotten', async () => {
    const attempt = await createSignInAttempt();
    expect(rememberSignInAttempt(attempt)).toBe(true);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(takeSignInAttempt(attempt.id)).toBeUndefined();
  });
});
