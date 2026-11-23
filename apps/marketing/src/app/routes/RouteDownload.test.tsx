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
  IOS_APP_STORE_URL,
} from '../../features/marketing/core/desktopDownloads';
import { analytics } from '../utils/utilAnalytic';
import { RouteDownload } from './RouteDownload';

vi.mock('../utils/utilAnalytic', () => ({
  analytics: { trackPosthog: vi.fn() },
}));

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
  // The phone toggle's sliding indicator measures itself.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64)';

describe('RouteDownload', () => {
  it('offers only the visitor installer, with the other as a link', () => {
    visitWith(MAC);
    expect(downloadLinks()).toEqual([['Download for macOS', '/download/mac']]);
    expect(
      screen.getByRole('link', { name: 'Download for Linux' })
    ).toHaveProperty('pathname', '/download/linux');
    cleanup();

    visitWith(LINUX);
    expect(downloadLinks()).toEqual([
      ['Download for Linux', '/download/linux'],
    ]);
    expect(
      screen.getByRole('link', { name: 'Download for macOS' })
    ).toHaveProperty('pathname', '/download/mac');
  });

  it('offers every installer to computers without one', () => {
    visitWith('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    expect(downloadLinks()).toEqual([
      ['Download for macOS', '/download/mac'],
      ['Download for Linux', '/download/linux'],
    ]);
    expect(screen.getByText(/A native Windows app is on the way/)).toBeTruthy();
    cleanup();

    visitWith('Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)');
    expect(downloadLinks()).toHaveLength(2);
    expect(screen.getByText(/On another computer/)).toBeTruthy();
  });

  it('leaves installer clicks to the browser, not the router', () => {
    visitWith(LINUX);
    for (const name of ['Download for Linux', 'Download for macOS']) {
      // The router cancels the clicks it handles; the edge serves these paths.
      expect(fireEvent.click(screen.getByRole('link', { name }))).toBe(true);
    }
  });

  it('records which installer was clicked', () => {
    visitWith(LINUX);
    const link = screen.getByRole('link', { name: 'Download for macOS' });
    // jsdom cannot follow the installer link.
    link.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(link);
    expect(analytics.trackPosthog).toHaveBeenCalledExactlyOnceWith(
      'desktop_download_clicked',
      { platform: 'macos', source: 'marketing' }
    );
  });

  it('switches the phone QR code between iPhone and Android', () => {
    visitWith(LINUX);
    expect(
      screen.getByRole('img', { name: 'QR code for App Store' })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Android' }));
    expect(
      screen.getByRole('img', { name: 'QR code for Google Play' })
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Get Macro on Google Play' })
    ).toHaveProperty('href', ANDROID_PLAY_STORE_URL);
  });

  it('starts the QR code on the visitor phone platform', () => {
    visitWith('Mozilla/5.0 (Linux; Android 14; Pixel Tablet)');
    expect(
      screen.getByRole('img', { name: 'QR code for Google Play' })
    ).toBeTruthy();
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
