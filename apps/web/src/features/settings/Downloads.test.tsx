/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { buttonClasses } from '@ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Downloads } from './Downloads';

const host = vi.hoisted(() => ({ desktopApp: false }));
const track = vi.hoisted(() => vi.fn());
const intel = vi.hoisted(() => ({ published: false }));

vi.mock('./core/desktop-downloads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./core/desktop-downloads')>()),
  intelMacPublished: () => intel.published,
}));

vi.mock('@core/util/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/util/platform')>()),
  isPlatform: (target: string) => target === 'desktop' && host.desktopApp,
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
  intel.published = false;
  Reflect.deleteProperty(navigator, 'userAgent');
  Reflect.deleteProperty(navigator, 'userAgentData');
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
      ['Download for macOS', 'https://macro.com/download/mac'],
      ['Download for Linux', 'https://macro.com/download/linux'],
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

describe('Downloads Intel Mac installer', () => {
  function reportArchitecture(architecture: string) {
    Object.defineProperty(navigator, 'userAgentData', {
      value: { getHighEntropyValues: async () => ({ architecture }) },
      configurable: true,
    });
  }

  it('stays hidden until the website links to it', () => {
    setUserAgent(MAC_UA);
    render(() => <Downloads />);

    expect(downloadLinks().map(([label]) => label)).toEqual([
      'Download for macOS',
      'Download for Linux',
    ]);
  });

  it('sits beside Apple silicon, with a hint when the browser cannot tell', async () => {
    intel.published = true;
    setUserAgent(MAC_UA);
    render(() => <Downloads />);

    expect(downloadLinks()).toEqual([
      ['Download for Apple silicon', 'https://macro.com/download/mac'],
      ['Download for Intel', 'https://macro.com/download/mac-intel'],
      ['Download for Linux', 'https://macro.com/download/linux'],
    ]);
    expect(
      await screen.findByText(
        'Not sure? Apple menu → About This Mac shows your chip.'
      )
    ).toBeTruthy();
    // Until the chip is known, the requirement fits both Mac installers.
    expect(
      screen.getByText('Requires macOS 14 (Sonoma) or later.')
    ).toBeTruthy();
  });

  it('names the Mac on its buttons for a computer that is not one', () => {
    intel.published = true;
    setUserAgent(WINDOWS_UA);
    render(() => <Downloads />);

    expect(downloadLinks().map(([label]) => label)).toEqual([
      'Download for Mac (Apple silicon)',
      'Download for Mac (Intel)',
      'Download for Linux',
    ]);
    expect(screen.queryByText(/Not sure\? Apple menu/)).toBeNull();
  });

  it('leads with Intel when Chromium reports an Intel Mac', async () => {
    intel.published = true;
    setUserAgent(MAC_UA);
    reportArchitecture('x86');
    render(() => <Downloads />);

    await vi.waitFor(() => {
      expect(downloadLinks()[0]?.[0]).toBe('Download for Intel');
    });
    expect(
      screen.getByText(
        'Requires macOS 14 (Sonoma) or later on a Mac with an Intel processor.'
      )
    ).toBeTruthy();
    expect(screen.queryByText(/Not sure\? Apple menu/)).toBeNull();
    // The leading installer is the primary button; the other is secondary.
    const primaryClass = buttonClasses({ variant: 'primary', size: 'md' });
    expect(
      screen.getByRole('link', { name: 'Download for Intel' }).className
    ).toBe(primaryClass);
    expect(
      screen.getByRole('link', { name: 'Download for Apple silicon' }).className
    ).not.toBe(primaryClass);
  });

  it('records Intel downloads as macos-intel', () => {
    intel.published = true;
    setUserAgent(MAC_UA);
    render(() => <Downloads />);

    const link = screen.getByRole('link', { name: 'Download for Intel' });
    link.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(link);

    expect(track).toHaveBeenCalledWith('desktop_download_clicked', {
      platform: 'macos-intel',
      source: 'app_settings',
    });
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
