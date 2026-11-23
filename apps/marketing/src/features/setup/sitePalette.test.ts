import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyPalette,
  onPaletteChange,
  pinnedPalette,
  preferredPalette,
} from './sitePalette';

describe('website dark-mode policy', () => {
  let change: (() => void) | undefined;
  beforeEach(() => {
    document.head.innerHTML = '<meta name="theme-color" content="#ffffff">';
    document.documentElement.dataset.palette = 'cream';
    document.documentElement.dataset.themeLight = 'true';
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        addEventListener: (_: string, listener: () => void) => {
          change = listener;
        },
        removeEventListener: vi.fn(),
      }))
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    change = undefined;
  });

  it.each([
    '/',
    '/email',
    '/start',
    '/demo',
    '/docs/switch-to-macro',
    '/posts/linear-alternative',
  ])('keeps %s dark even with an explicit cream preference', (path) => {
    history.replaceState(null, '', `${path}?theme=cream`);
    expect(pinnedPalette()).toBe('dark');
    expect(preferredPalette()).toBe('dark');
    applyPalette('cream');
    expect(document.documentElement.dataset.palette).toBeUndefined();
    expect(document.documentElement.dataset.themeLight).toBe('false');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(
      document
        .querySelector('meta[name="theme-color"]')
        ?.getAttribute('content')
    ).toBe('#000000');
  });

  it('stays dark when navigating Home and when the system theme changes', () => {
    history.replaceState(null, '', '/email?theme=dark');
    applyPalette(preferredPalette());
    // Router effects may run before history updates the browser pathname.
    applyPalette(preferredPalette(), '/');
    expect(document.documentElement.hasAttribute('data-homepage')).toBe(true);
    history.replaceState(null, '', '/');
    const cleanup = onPaletteChange(applyPalette);
    change?.();
    expect(document.documentElement.dataset.themeLight).toBe('false');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(document.documentElement.hasAttribute('data-homepage')).toBe(true);
    cleanup();
  });

  it.each(['index.html', 'start.html'])(
    'paints %s dark before hydration',
    (entry) => {
      const html = readFileSync(entry, 'utf8');
      const script = html.match(
        /<script>\s*\/\/ First-paint palette[\s\S]*?<\/script>/
      )?.[0];
      expect(script).toBeDefined();
      for (const path of ['/', '/email', '/start']) {
        history.replaceState(null, '', `${path}?theme=cream`);
        delete document.documentElement.dataset.palette;
        new Function(
          'location',
          'document',
          'matchMedia',
          script!.replace(/<\/?script>/g, '')
        )(location, document, matchMedia);
        expect(document.documentElement.dataset.themeLight).toBe('false');
        expect(document.documentElement.style.colorScheme).toBe('dark');
        expect(document.documentElement.dataset.palette).toBeUndefined();
        expect(
          document
            .querySelector('meta[name="theme-color"]')
            ?.getAttribute('content')
        ).toBe('#000000');
      }
    }
  );
});
