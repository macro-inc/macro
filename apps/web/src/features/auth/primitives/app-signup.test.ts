import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openSystemBrowser: vi.fn(),
  release: vi.fn(),
  hold: vi.fn(),
}));

vi.mock('@core/auth/native-auth', () => ({
  openSystemBrowser: mocks.openSystemBrowser,
}));
vi.mock('@core/util/reloadForNewerBuild', () => ({
  holdAutomaticReload: () => {
    mocks.hold();
    return mocks.release;
  },
}));
vi.mock('@core/util/webOrigin', () => ({
  getWebOrigin: () => 'https://macro.com',
}));

const { appSignupVerifier, finishAppSignups, startAppSignup } = await import(
  './app-signup'
);

async function sha256Base64Url(text: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text)
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

function openedUrl(call = 0) {
  return new URL(mocks.openSystemBrowser.mock.calls[call][0]);
}

describe('startAppSignup', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.openSystemBrowser.mockResolvedValue(true);
  });
  afterEach(() => finishAppSignups());

  it('sends the challenge to the browser and keeps its verifier', async () => {
    expect(await startAppSignup()).toBe('opened');

    const url = openedUrl();
    expect(url.origin).toBe('https://www.macro.com');
    expect(url.pathname).toBe('/app/signup');
    const handoffId = url.searchParams.get('app_handoff');
    const challenge = url.searchParams.get('app_challenge');
    expect(handoffId).toBeTruthy();
    const verifier = appSignupVerifier(handoffId ?? '');
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(await sha256Base64Url(verifier ?? ''));
    // The verifier never leaves the app.
    expect(url.href).not.toContain(verifier);
  });

  it('keeps each sign-up started, until one signs in', async () => {
    await startAppSignup();
    await startAppSignup();
    const first = openedUrl(0).searchParams.get('app_handoff') ?? '';
    const second = openedUrl(1).searchParams.get('app_handoff') ?? '';
    expect(appSignupVerifier(first)).toBeDefined();
    expect(appSignupVerifier(second)).toBeDefined();
    expect(appSignupVerifier(first)).not.toBe(appSignupVerifier(second));

    finishAppSignups();
    expect(appSignupVerifier(first)).toBeUndefined();
    expect(appSignupVerifier(second)).toBeUndefined();
  });

  it('opens nothing when it cannot keep the verifier', async () => {
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
    expect(await startAppSignup()).toBe('failed');
    expect(mocks.openSystemBrowser).not.toHaveBeenCalled();
    expect(mocks.hold).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it('holds reloads until a sign-in arrives, and not when the browser fails', async () => {
    await startAppSignup();
    expect(mocks.hold).toHaveBeenCalledTimes(1);
    expect(mocks.release).not.toHaveBeenCalled();
    finishAppSignups();
    expect(mocks.release).toHaveBeenCalledTimes(1);

    mocks.openSystemBrowser.mockResolvedValue(false);
    expect(await startAppSignup()).toBe('failed');
    expect(mocks.release).toHaveBeenCalledTimes(2);
  });
});
