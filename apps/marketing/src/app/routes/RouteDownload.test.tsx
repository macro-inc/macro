import { MemoryRouter, Route } from '@solidjs/router';
import { cleanup, render, screen, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ANDROID_PLAY_STORE_URL,
  FALLBACK_DOWNLOAD_URLS,
  IOS_APP_STORE_URL,
} from '../../features/marketing/core/desktopDownloads';
import { RouteDownload } from './RouteDownload';

const latest = {
  macos: 'https://example.com/Macro-latest-aarch64-darwin.dmg',
  linux: 'https://example.com/Macro-latest-x86_64-linux.AppImage',
};

function visitWith(userAgent: string, maxTouchPoints = 0) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  // jsdom has no maxTouchPoints to spy on.
  Object.defineProperty(navigator, 'maxTouchPoints', {
    configurable: true,
    value: maxTouchPoints,
  });
  render(() => (
    <MemoryRouter>
      <Route path="/" component={RouteDownload} />
    </MemoryRouter>
  ));
}

function downloadLinks() {
  return within(screen.getByRole('list', { name: 'Desktop installers' }))
    .getAllByRole('link')
    .map((link) => [link.textContent, link.getAttribute('href')]);
}

beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json([
        {
          assets: [
            {
              name: 'Macro-latest-aarch64-darwin.dmg',
              browser_download_url: latest.macos,
            },
            {
              name: 'Macro-latest-x86_64-linux.AppImage',
              browser_download_url: latest.linux,
            },
          ],
        },
      ])
    )
  );
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, 'maxTouchPoints');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('RouteDownload', () => {
  it('offers the Linux installer first on Linux', async () => {
    visitWith('Mozilla/5.0 (X11; Linux x86_64)');
    expect(downloadLinks()).toEqual([
      ['Download for Linux', FALLBACK_DOWNLOAD_URLS.linux],
      ['Download for macOS', FALLBACK_DOWNLOAD_URLS.macos],
    ]);
    await vi.waitFor(() =>
      expect(downloadLinks()).toEqual([
        ['Download for Linux', latest.linux],
        ['Download for macOS', latest.macos],
      ])
    );
  });

  it('offers the Mac installer first on macOS and other computers', () => {
    visitWith('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    expect(downloadLinks().map(([label]) => label)).toEqual([
      'Download for macOS',
      'Download for Linux',
    ]);
    cleanup();
    visitWith('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    expect(downloadLinks()[0]?.[0]).toBe('Download for macOS');
    expect(screen.getByText(/Windows is not supported yet/)).toBeTruthy();
  });

  it('leads with the mobile app on phones', () => {
    visitWith('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5);
    expect(
      screen.getAllByRole('link', { name: 'Download for iOS' })[0]
    ).toHaveProperty('href', IOS_APP_STORE_URL);
    cleanup();
    visitWith('Mozilla/5.0 (Linux; Android 14; Pixel 8)', 5);
    expect(
      screen.getAllByRole('link', { name: 'Download for Android' })[0]
    ).toHaveProperty('href', ANDROID_PLAY_STORE_URL);
  });
});
