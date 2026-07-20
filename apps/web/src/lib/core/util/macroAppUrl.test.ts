import { isTauri } from '@core/util/platform';
import { emit } from '@tauri-apps/api/event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { maybeOpenInApp, parseInternalAppLink } from './macroAppUrl';

vi.mock('@core/util/platform', () => ({
  isTauri: vi.fn(() => false),
}));

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(() => Promise.resolve()),
}));

afterEach(() => {
  vi.mocked(isTauri).mockReturnValue(false);
  vi.mocked(emit).mockClear();
});

// jsdom's window.location.hostname is 'localhost', which
// isValidMentionHostname pairs with dev.macro.com outside of Tauri.
describe('parseInternalAppLink', () => {
  it('parses a macro app link into path and query', () => {
    expect(
      parseInternalAppLink('https://dev.macro.com/app/component/abc?foo=bar')
    ).toEqual({ path: '/component/abc', query: 'foo=bar' });
  });

  it('maps a bare /app path to the router root', () => {
    expect(parseInternalAppLink('https://dev.macro.com/app')).toEqual({
      path: '/',
      query: '',
    });
  });

  it('accepts same-host links', () => {
    expect(
      parseInternalAppLink('http://localhost:3000/app/channel/123')
    ).toEqual({ path: '/channel/123', query: '' });
  });

  it('strips a www prefix from the hostname', () => {
    expect(parseInternalAppLink('https://www.dev.macro.com/app/x')).toEqual({
      path: '/x',
      query: '',
    });
  });

  it('rejects non-/app paths on a macro host', () => {
    expect(parseInternalAppLink('https://dev.macro.com/pricing')).toBeNull();
    expect(parseInternalAppLink('https://dev.macro.com/apple')).toBeNull();
  });

  it('rejects /app paths on foreign hosts', () => {
    expect(
      parseInternalAppLink('https://evil.com/app/component/abc')
    ).toBeNull();
  });

  it('rejects prod macro links outside of Tauri when not on macro.com', () => {
    expect(
      parseInternalAppLink('https://macro.com/app/component/abc')
    ).toBeNull();
  });

  it('accepts prod macro links under Tauri', () => {
    vi.mocked(isTauri).mockReturnValue(true);
    expect(parseInternalAppLink('https://macro.com/app/component/abc')).toEqual(
      {
        path: '/component/abc',
        query: '',
      }
    );
  });

  it('rejects invalid urls', () => {
    expect(parseInternalAppLink('not a url')).toBeNull();
    expect(parseInternalAppLink('/app/component/abc')).toBeNull();
  });
});

describe('maybeOpenInApp', () => {
  it('does nothing outside of Tauri', () => {
    expect(maybeOpenInApp('https://dev.macro.com/app/component/abc')).toBe(
      false
    );
    expect(emit).not.toHaveBeenCalled();
  });

  it('emits a navigate event for app links under Tauri', () => {
    vi.mocked(isTauri).mockReturnValue(true);
    expect(
      maybeOpenInApp('https://macro.com/app/channel/123?message=456')
    ).toBe(true);
    expect(emit).toHaveBeenCalledWith('navigate', {
      path: '/channel/123',
      query: 'message=456',
    });
  });

  it('leaves external links alone under Tauri', () => {
    vi.mocked(isTauri).mockReturnValue(true);
    expect(maybeOpenInApp('https://github.com/macro-inc')).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });
});
