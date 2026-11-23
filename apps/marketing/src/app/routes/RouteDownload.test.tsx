import { MemoryRouter, Route } from '@solidjs/router';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ANDROID_PLAY_STORE_URL,
  FALLBACK_DOWNLOAD_URLS,
  IOS_APP_STORE_URL,
} from '../../features/marketing/core/desktopDownloads';
import { analytics } from '../utils/utilAnalytic';
import { RouteDownload } from './RouteDownload';

vi.mock('../utils/utilAnalytic', () => ({
  analytics: { trackPosthog: vi.fn() },
}));

const latest = {
  macos: 'https://example.com/Macro-latest-aarch64-darwin.dmg',
  linux: 'https://example.com/Macro-latest-x86_64-linux.AppImage',
};

function visitWith(userAgent: string) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  render(() => (
    <MemoryRouter>
      <Route path="/" component={RouteDownload} />
    </MemoryRouter>
  ));
}

function downloadLinks(list = 'Desktop installers') {
  return within(screen.getByRole('list', { name: list }))
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
  vi.clearAllMocks();
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

  it('records which installer was clicked', () => {
    visitWith('Mozilla/5.0 (X11; Linux x86_64)');
    const link = screen.getByRole('link', { name: 'Download for macOS' });
    // jsdom cannot follow the installer link.
    link.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(link);
    expect(analytics.trackPosthog).toHaveBeenCalledExactlyOnceWith(
      'desktop_download_clicked',
      { platform: 'macos', source: 'marketing' }
    );
  });

  it('leads the phone list with the phone platform store', () => {
    visitWith('Mozilla/5.0 (Linux; Android 14; Pixel 8)');
    expect(downloadLinks('Mobile apps')).toEqual([
      ['Download for Android', ANDROID_PLAY_STORE_URL],
      ['Download for iOS', IOS_APP_STORE_URL],
    ]);
    cleanup();
    visitWith('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)');
    expect(downloadLinks('Mobile apps')).toEqual([
      ['Download for iOS', IOS_APP_STORE_URL],
      ['Download for Android', ANDROID_PLAY_STORE_URL],
    ]);
  });
});
