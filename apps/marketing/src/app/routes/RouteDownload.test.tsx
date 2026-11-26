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

const intel = vi.hoisted(() => ({ published: false }));
vi.mock(
  '../../features/marketing/core/desktopDownloads',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('../../features/marketing/core/desktopDownloads')
    >()),
    intelMacPublished: () => intel.published,
  })
);

const HINT = 'Not sure? Apple menu → About This Mac shows your chip.';

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
  intel.published = false;
  Reflect.deleteProperty(navigator, 'userAgentData');
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

  describe('Intel Macs', () => {
    function reportChip(architecture: string) {
      Object.defineProperty(navigator, 'userAgentData', {
        value: { getHighEntropyValues: async () => ({ architecture }) },
        configurable: true,
      });
    }

    it('get no Intel installer until the edge links to one', () => {
      visitWith(MAC);
      expect(downloadLinks()).toEqual([
        ['Download for macOS', '/download/mac'],
      ]);
      expect(screen.queryByRole('link', { name: /Intel/ })).toBeNull();
      expect(screen.queryByText(HINT)).toBeNull();
    });

    it('lead with Apple silicon, Intel as a link, and a hint when the browser cannot tell', async () => {
      intel.published = true;
      visitWith(MAC);
      expect(downloadLinks()).toEqual([
        ['Download for Apple silicon', '/download/mac'],
      ]);
      expect(
        screen.getByRole('link', { name: 'Download for Intel' })
      ).toHaveProperty('pathname', '/download/mac-intel');
      expect(await screen.findByText(HINT)).toBeTruthy();
    });

    it('lead with Intel when Chromium reports an Intel Mac', async () => {
      intel.published = true;
      reportChip('x86');
      visitWith(MAC);
      await vi.waitFor(() => {
        expect(downloadLinks()).toEqual([
          ['Download for Intel', '/download/mac-intel'],
        ]);
      });
      expect(
        screen.getByText(
          'Requires macOS 14 (Sonoma) or later on a Mac with an Intel processor.'
        )
      ).toBeTruthy();
      expect(
        screen.getByRole('link', { name: 'Download for Apple silicon' })
      ).toHaveProperty('pathname', '/download/mac');
      expect(screen.queryByText(HINT)).toBeNull();
    });

    it('are named as Macs for other computers, without the chip hint', () => {
      intel.published = true;
      visitWith(LINUX);
      expect(
        screen.getByRole('link', { name: 'Download for Mac (Intel)' })
      ).toHaveProperty('pathname', '/download/mac-intel');
      cleanup();

      visitWith('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
      expect(downloadLinks()).toEqual([
        ['Download for Mac (Apple silicon)', '/download/mac'],
        ['Download for Mac (Intel)', '/download/mac-intel'],
        ['Download for Linux', '/download/linux'],
      ]);
      expect(screen.queryByText(HINT)).toBeNull();
    });

    it('record Intel downloads as macos-intel', () => {
      intel.published = true;
      visitWith(MAC);
      const link = screen.getByRole('link', { name: 'Download for Intel' });
      link.addEventListener('click', (event) => event.preventDefault());
      fireEvent.click(link);
      expect(analytics.trackPosthog).toHaveBeenCalledExactlyOnceWith(
        'desktop_download_clicked',
        { platform: 'macos-intel', source: 'marketing' }
      );
    });
  });
});
