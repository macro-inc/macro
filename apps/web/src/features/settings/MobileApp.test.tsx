/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileApp } from './MobileApp';

const device = vi.hoisted(() => ({ phone: false }));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => device.phone }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn() },
}));
vi.mock('@core/context/user', () => ({
  useReferralCode: () => () => null,
}));

// Mock the SVG imports
vi.mock('@design/app-store.svg', () => ({
  default: () => '<svg data-testid="app-store-qr"></svg>',
}));
vi.mock('@design/play-store.svg', () => ({
  default: () => '<svg data-testid="play-store-qr"></svg>',
}));
vi.mock('@icon/system/regular/arrow-up-right.svg', () => ({
  default: () => null,
}));
vi.mock('@icon/system/regular/link.svg', () => ({
  default: () => '<svg></svg>',
}));

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
  // Mock clipboard API
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });
});

afterEach(() => {
  cleanup();
  device.phone = false;
  Reflect.deleteProperty(navigator, 'userAgent');
  Reflect.deleteProperty(navigator, 'maxTouchPoints');
  motionStyles.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('MobileApp', () => {
  const APP_STORE_URL = 'https://apps.apple.com/us/app/macro-app/id6743133649';
  const PLAY_STORE_URL =
    'https://play.google.com/store/apps/details?id=com.macro.workspace.mobile';

  it('renders the QR code and text', () => {
    render(() => <MobileApp />);

    expect(screen.getByText(/Download Macro on the/)).toBeTruthy();
    // Use getAllByText and check it appears multiple times (in the paragraph and in the button)
    const appStoreText = screen.getAllByText(/App Store/);
    expect(appStoreText.length).toBeGreaterThan(0);
  });

  it('renders the "Copy link" button', () => {
    render(() => <MobileApp />);

    // The button has aria-label="Copy App Store link" from the label prop
    const copyButton = screen.getByRole('button', {
      name: /Copy App Store link/,
    });
    expect(copyButton).toBeTruthy();
    // Verify it contains the "Copy link" text
    expect(copyButton.textContent).toContain('Copy link');
  });

  it('copies the App Store URL to clipboard when "Copy link" is clicked', async () => {
    render(() => <MobileApp />);

    const copyButton = screen.getByRole('button', {
      name: /Copy App Store link/,
    });
    fireEvent.click(copyButton);

    await vi.waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(APP_STORE_URL);
    });
  });

  it('copies the Google Play URL after switching to Android', async () => {
    render(() => <MobileApp />);

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

  it('shows success toast when copy succeeds', async () => {
    const { toast } = await import('@core/component/Toast/Toast');
    render(() => <MobileApp />);

    const copyButton = screen.getByRole('button', {
      name: /Copy App Store link/,
    });
    fireEvent.click(copyButton);

    await vi.waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        'Link copied to clipboard.',
        expect.any(Object)
      );
    });
  });

  it('shows failure toast when copy fails', async () => {
    const { toast } = await import('@core/component/Toast/Toast');
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(
      new Error('Failed')
    );

    render(() => <MobileApp />);

    const copyButton = screen.getByRole('button', {
      name: /Copy App Store link/,
    });
    fireEvent.click(copyButton);

    await vi.waitFor(() => {
      expect(toast.failure).toHaveBeenCalledWith('Could not copy link');
    });
  });

  it.each([
    [
      'an iPhone',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      [['App Store', APP_STORE_URL]],
    ],
    [
      'an Android phone',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8)',
      [['Google Play', PLAY_STORE_URL]],
    ],
    [
      'an unrecognized phone',
      'Mozilla/5.0 (Mobile; rv:48.0)',
      [
        ['App Store', APP_STORE_URL],
        ['Google Play', PLAY_STORE_URL],
      ],
    ],
  ])('links %s to its store without a QR code', (_, userAgent, expected) => {
    device.phone = true;
    Object.defineProperty(navigator, 'userAgent', {
      value: userAgent,
      configurable: true,
    });
    Object.defineProperty(navigator, 'maxTouchPoints', {
      value: 5,
      configurable: true,
    });
    render(() => <MobileApp />);

    expect(
      screen
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')])
    ).toEqual(expected);
    expect(screen.queryByRole('radio')).toBeNull();
  });
});
