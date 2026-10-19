/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileApp } from './MobileApp';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
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
vi.mock('@phosphor/arrow-up-right.svg', () => ({
  default: () => '<svg></svg>',
}));
vi.mock('@phosphor/link.svg', () => ({
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
  motionStyles.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('MobileApp', () => {
  const APP_STORE_URL = 'https://apps.apple.com/us/app/macro-app/id6743133649';

  it('renders the QR code and text', () => {
    render(() => <MobileApp />);

    expect(screen.getByText(/Download Macro Alpha on the/)).toBeTruthy();
    // Use getAllByText and check it appears multiple times (in the paragraph and in the button)
    const appStoreText = screen.getAllByText(/App Store/);
    expect(appStoreText.length).toBeGreaterThan(0);
  });

  it('renders the "Open in App Store" link with correct attributes', () => {
    render(() => <MobileApp />);

    const link = screen.getByRole('link', { name: /Open in App Store/ });
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe(APP_STORE_URL);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
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
});
