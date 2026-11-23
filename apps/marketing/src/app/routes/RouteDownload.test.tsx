import { MemoryRouter, Route } from '@solidjs/router';
import { cleanup, render, screen, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FALLBACK_DOWNLOAD_URLS } from '../../features/marketing/core/desktopDownloads';
import { RouteDownload } from './RouteDownload';

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
});
