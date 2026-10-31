import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const hasLoginCookie = vi.hoisted(() => vi.fn(() => false));
vi.mock('@core/util/cookies', () => ({ hasLoginCookie }));

beforeEach(() => {
  vi.resetModules();
  hasLoginCookie.mockReturnValue(false);
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), {
      location: new URL('https://macro.com/app'),
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

it('checks shared dev credentials on a fresh preview origin without a local login marker', async () => {
  window.location.hostname = 'branch-abc123.preview.macro.com';
  const { shouldQueryUserInfo } = await import('./user-info-gate');
  expect(shouldQueryUserInfo()).toBe(true);
});

it.each([
  'macro.com',
  'dev.macro.com',
  'localhost',
  'notpreview.macro.com',
  'branch.preview.macro.com.example.com',
])('keeps anonymous identity checks disabled on %s', async (hostname) => {
  window.location.hostname = hostname;
  const { shouldQueryUserInfo } = await import('./user-info-gate');
  expect(shouldQueryUserInfo()).toBe(false);
});

it('checks identity with an existing login marker', async () => {
  hasLoginCookie.mockReturnValue(true);
  const { shouldQueryUserInfo } = await import('./user-info-gate');
  expect(shouldQueryUserInfo()).toBe(true);
});

it('wakes an anonymous identity observer when another tab publishes a login marker', async () => {
  const { shouldQueryUserInfo } = await import('./user-info-gate');
  expect(shouldQueryUserInfo()).toBe(false);
  window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }));
  expect(shouldQueryUserInfo()).toBe(false);

  hasLoginCookie.mockReturnValue(true);
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: 'macro:login',
      newValue: 'true',
    })
  );
  expect(shouldQueryUserInfo()).toBe(true);
});
