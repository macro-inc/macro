import { isTauri } from '@core/util/platform';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseInternalAppLink } from './macroAppUrl';

vi.mock('@core/util/platform', () => ({
  isTauri: vi.fn(() => false),
}));

afterEach(() => {
  vi.mocked(isTauri).mockReturnValue(false);
});

// jsdom's window.location.hostname is 'localhost', which
// isValidMacroAppHostname pairs with dev.macro.com outside of Tauri.
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

  it('does not treat a mid-string www. as a macro host', () => {
    // Only a leading `www.` is stripped, so `macro.www.com` (a subdomain of
    // the foreign `www.com`) must not collapse to `macro.com`. Checked under
    // Tauri, where localhost is paired with the prod/dev/staging hosts.
    vi.mocked(isTauri).mockReturnValue(true);
    expect(
      parseInternalAppLink('https://macro.www.com/app/component/abc')
    ).toBeNull();
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

  it('accepts staging macro links under Tauri', () => {
    vi.mocked(isTauri).mockReturnValue(true);
    expect(
      parseInternalAppLink('https://staging.macro.com/app/component/abc')
    ).toEqual({
      path: '/component/abc',
      query: '',
    });
  });

  it('accepts macro links under Tauri when served from tauri.localhost', () => {
    // Under the http asset scheme (e.g. Windows/Android) the webview origin is
    // tauri.localhost, not localhost.
    vi.mocked(isTauri).mockReturnValue(true);
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { hostname: 'tauri.localhost' },
    });
    try {
      expect(
        parseInternalAppLink('https://macro.com/app/component/abc')
      ).toEqual({ path: '/component/abc', query: '' });
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: original,
      });
    }
  });

  it('rejects invalid urls', () => {
    expect(parseInternalAppLink('not a url')).toBeNull();
    expect(parseInternalAppLink('/app/component/abc')).toBeNull();
  });
});
