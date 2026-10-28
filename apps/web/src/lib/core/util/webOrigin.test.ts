import { afterEach, describe, expect, it } from 'vitest';
import { getCurrentWebUrl, getWebOrigin } from './webOrigin';

const original = window.location;

/** The native shell, which `isTauri` detects by its injected internals. */
function inNativeApp(location: Partial<Location>) {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  setLocation(location);
}

function setLocation(value: Partial<Location>) {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...original, ...value },
  });
}

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: original,
  });
});

describe('getWebOrigin', () => {
  it('keeps the serving origin on the web', () => {
    setLocation({ origin: 'https://staging.macro.com' });
    expect(getWebOrigin()).toBe('https://staging.macro.com');
  });

  // The native shells serve the app from their own origin, which means nothing
  // to a recipient.
  it.each(['http://tauri.localhost', 'tauri://localhost'])(
    'replaces the native origin %s with the web app',
    (origin) => {
      inNativeApp({ origin });
      expect(getWebOrigin()).toBe('https://macro.com');
    }
  );
});

describe('getCurrentWebUrl', () => {
  it('is the current URL on the web', () => {
    setLocation({
      href: 'https://macro.com/app/agent/session-1/~/drive/md/doc-1?view=all',
      hash: '',
    });
    expect(getCurrentWebUrl()).toBe(
      'https://macro.com/app/agent/session-1/~/drive/md/doc-1?view=all'
    );
  });

  // The native app routes through the hash, so its own href names both a host
  // the recipient cannot reach and a path the web app does not route.
  it('rebuilds the native hash route as a web app path', () => {
    inNativeApp({
      href: 'http://tauri.localhost/#/agent/session-1/~/drive/md/doc-1',
      hash: '#/agent/session-1/~/drive/md/doc-1',
    });
    expect(getCurrentWebUrl()).toBe(
      'https://macro.com/app/agent/session-1/~/drive/md/doc-1'
    );
  });

  it('keeps the query the native hash route carries', () => {
    inNativeApp({
      href: 'http://tauri.localhost/#/channel/channel-1?s0.channel.message=m1',
      hash: '#/channel/channel-1?s0.channel.message=m1',
    });
    expect(getCurrentWebUrl()).toBe(
      'https://macro.com/app/channel/channel-1?s0.channel.message=m1'
    );
  });

  it.each(['', '#', '#/'])('maps the native root hash %j to /app', (hash) => {
    inNativeApp({ href: `http://tauri.localhost/${hash}`, hash });
    expect(getCurrentWebUrl()).toBe('https://macro.com/app');
  });
});
