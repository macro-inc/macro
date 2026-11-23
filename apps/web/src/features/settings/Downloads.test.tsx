/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FALLBACK_DOWNLOAD_URLS } from './core/desktop-downloads';
import { Downloads } from './Downloads';

const host = vi.hoisted(() => ({ desktopApp: false }));
const installers = vi.hoisted(() => ({
  current: { isPending: true, data: undefined } as {
    isPending: boolean;
    data: { macos: string; linux: string } | undefined;
  },
}));
const track = vi.hoisted(() => vi.fn());

vi.mock('@core/util/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/util/platform')>()),
  isPlatform: (target: string) => target === 'desktop' && host.desktopApp,
}));
vi.mock('./queries/desktop-installers', () => ({
  useDesktopInstallersQuery: () => installers.current,
}));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track }),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn() },
}));
vi.mock('@core/context/user', () => ({
  useReferralCode: () => () => null,
}));
vi.mock('@design/app-store.svg', () => ({
  default: () => '<svg data-testid="app-store-qr"></svg>',
}));
vi.mock('@design/play-store.svg', () => ({
  default: () => '<svg data-testid="play-store-qr"></svg>',
}));
vi.mock('@icon/system/regular/link.svg', () => ({
  default: () => '<svg></svg>',
}));

const APP_STORE_URL = 'https://apps.apple.com/us/app/macro-app/id6743133649';
const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.macro.workspace.mobile';
const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const LINUX_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36';
const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

let motionStyles: HTMLStyleElement;
beforeEach(() => {
  motionStyles = document.createElement('style');
  motionStyles.textContent =
    '* { transition-duration: 0s; animation-name: none; }';
  document.head.append(motionStyles);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  cleanup();
  host.desktopApp = false;
  installers.current = { isPending: true, data: undefined };
  Reflect.deleteProperty(navigator, 'userAgent');
  motionStyles.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function setUserAgent(value: string) {
  Object.defineProperty(navigator, 'userAgent', { value, configurable: true });
}

function downloadLinks() {
  return screen
    .queryAllByRole('link', { name: /^Download for/ })
    .map((link) => [link.textContent, link.getAttribute('href')]);
}

describe('Downloads desktop installers', () => {
  it('leads with the detected platform and offers the other', () => {
    setUserAgent(MAC_UA);
    render(() => <Downloads />);

    expect(downloadLinks()).toEqual([
      ['Download for macOS', FALLBACK_DOWNLOAD_URLS.macos],
      ['Download for Linux', FALLBACK_DOWNLOAD_URLS.linux],
    ]);
  });

  it('leads with Linux on Linux', () => {
    setUserAgent(LINUX_UA);
    render(() => <Downloads />);

    expect(downloadLinks().map(([label]) => label)).toEqual([
      'Download for Linux',
      'Download for macOS',
    ]);
  });

  it('offers both installers on a computer without one', () => {
    setUserAgent(WINDOWS_UA);
    render(() => <Downloads />);

    expect(downloadLinks().map(([label]) => label)).toEqual([
      'Download for macOS',
      'Download for Linux',
    ]);
  });

  it('links the newest installers once GitHub answers', () => {
    setUserAgent(MAC_UA);
    installers.current = {
      isPending: false,
      data: {
        macos: 'https://example.com/new.dmg',
        linux: 'https://example.com/new.AppImage',
      },
    };
    render(() => <Downloads />);

    expect(downloadLinks()).toEqual([
      ['Download for macOS', 'https://example.com/new.dmg'],
      ['Download for Linux', 'https://example.com/new.AppImage'],
    ]);
  });

  it('records which installer was downloaded', () => {
    setUserAgent(MAC_UA);
    render(() => <Downloads />);

    const linux = screen.getByRole('link', { name: 'Download for Linux' });
    // jsdom does not navigate; keep the click from trying to.
    linux.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(linux);

    expect(track).toHaveBeenCalledWith('desktop_download_clicked', {
      platform: 'linux',
      source: 'app_settings',
    });
  });

  it('shows only the phone app inside the desktop app', () => {
    host.desktopApp = true;
    setUserAgent(MAC_UA);
    render(() => <Downloads />);

    expect(downloadLinks()).toEqual([]);
    expect(screen.getByText('Get Macro on your phone.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'iPhone' })).toBeTruthy();
  });
});

describe('Downloads mobile app', () => {
  it('copies the App Store URL', async () => {
    render(() => <Downloads />);

    fireEvent.click(
      screen.getByRole('button', { name: /Copy App Store link/ })
    );

    await vi.waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(APP_STORE_URL);
    });
  });

  it('copies the Google Play URL after switching to Android', async () => {
    render(() => <Downloads />);

    fireEvent.click(screen.getByRole('radio', { name: 'Android' }));
    fireEvent.click(
      await screen.findByRole('button', { name: /Copy Google Play link/ })
    );

    await vi.waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        PLAY_STORE_URL
      );
    });
  });

  it('reports a failed copy', async () => {
    const { toast } = await import('@core/component/Toast/Toast');
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(
      new Error('Failed')
    );
    render(() => <Downloads />);

    fireEvent.click(
      screen.getByRole('button', { name: /Copy App Store link/ })
    );

    await vi.waitFor(() => {
      expect(toast.failure).toHaveBeenCalledWith('Could not copy link');
    });
  });
});
