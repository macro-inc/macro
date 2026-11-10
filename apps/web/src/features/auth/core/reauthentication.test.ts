import { describe, expect, it } from 'vitest';
import {
  authenticationParams,
  reauthenticationReturnUrl,
  requiresReauthentication,
} from './reauthentication';

describe('fresh login return', () => {
  it('requires an explicit fresh-login request and preserves its destination after authentication', () => {
    const url = new URL(
      'https://example.com/app/login?prompt=login&max_age=0&redirect=%2Fpasswords'
    );
    expect(requiresReauthentication(url)).toBe(true);
    const target = new URL(reauthenticationReturnUrl(url));
    expect(requiresReauthentication(target)).toBe(false);
    expect(target.searchParams.get('redirect')).toBe('/passwords');
    expect(
      requiresReauthentication(
        new URL('https://example.com/app/login?max_age=0')
      )
    ).toBe(false);
  });
});

it('keeps fresh authentication and the destination through native hash routing', () => {
  const native = new URL(
    'tauri://localhost/#/login?prompt=login&max_age=0&redirect=%2Fpasswords'
  );
  expect(requiresReauthentication(native)).toBe(true);
  expect(authenticationParams(native).get('redirect')).toBe('/passwords');
  const returned = new URL(reauthenticationReturnUrl(native));
  expect(requiresReauthentication(returned)).toBe(false);
  expect(authenticationParams(returned).get('redirect')).toBe('/passwords');
  expect(returned.hash).toBe('#/login?redirect=%2Fpasswords');
});
