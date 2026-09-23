import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => vi.fn());
vi.mock('@core/mobile/isNativeMobilePlatform', () => ({
  isNativeMobilePlatform: native,
}));

import {
  clearPostLoginRedirect,
  consumePostLoginRedirect,
  setPostLoginRedirect,
} from './postLoginRedirect';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  native.mockReturnValue(true);
});

describe('native post-login destinations', () => {
  it('restores hash-router locations without nesting the router root', () => {
    setPostLoginRedirect(`${window.location.origin}/#/task/123?view=comments`);
    expect(consumePostLoginRedirect()).toBe('/task/123?view=comments');
    setPostLoginRedirect(`${window.location.origin}/#//evil.example/task/123`);
    expect(consumePostLoginRedirect()).toBeNull();
  });

  it('survives session storage loss and consumes the destination once', () => {
    setPostLoginRedirect('/task/123?view=comments#reply');
    sessionStorage.clear();
    expect(consumePostLoginRedirect()).toBe('/task/123?view=comments#reply');
    expect(consumePostLoginRedirect()).toBeNull();
  });

  it('rejects external URLs and clears destinations on explicit logout', () => {
    setPostLoginRedirect('https://evil.example/task/123');
    expect(consumePostLoginRedirect()).toBeNull();
    setPostLoginRedirect('/task/123');
    clearPostLoginRedirect();
    expect(consumePostLoginRedirect()).toBeNull();
  });

  it('expires abandoned destinations and ignores malformed storage', () => {
    const clock = vi.spyOn(Date, 'now');
    clock.mockReturnValue(0);
    setPostLoginRedirect('/task/123');
    clock.mockReturnValue(31 * 60 * 1000);
    expect(consumePostLoginRedirect()).toBeNull();
    clock.mockRestore();
    localStorage.setItem('nativePostLoginRedirect', 'broken');
    expect(consumePostLoginRedirect()).toBeNull();
  });

  it('preserves the browser session-storage behavior', () => {
    native.mockReturnValue(false);
    setPostLoginRedirect('/app/task/123');
    expect(sessionStorage.getItem('redirectUrl')).toBe('/app/task/123');
    expect(consumePostLoginRedirect()).toBe('/app/task/123');
    expect(consumePostLoginRedirect()).toBeNull();
  });
});
