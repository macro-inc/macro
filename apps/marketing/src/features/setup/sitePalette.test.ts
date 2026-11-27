import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyPalette,
  choosePalette,
  preferredPalette,
  SITE_PALETTE_STORAGE_KEY,
  sitePalette,
} from './sitePalette';

const ROUTES = ['/', '/email', '/start', '/docs/switch-to-macro'];

describe('website palette policy', () => {
  beforeEach(() => {
    document.head.innerHTML = '<meta name="theme-color" content="#000000">';
    delete document.documentElement.dataset.palette;
    localStorage.clear();
    history.replaceState(null, '', '/');
    // The OS asks for light throughout: the site must not follow it.
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(ROUTES)('stays dark on %s until the visitor chooses', (path) => {
    history.replaceState(null, '', path);
    expect(preferredPalette()).toBe('dark');
    applyPalette(preferredPalette());
    expect(document.documentElement.dataset.palette).toBeUndefined();
    expect(document.documentElement.dataset.themeLight).toBe('false');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(
      document
        .querySelector('meta[name="theme-color"]')
        ?.getAttribute('content')
    ).toBe('#000000');
  });

  it.each(ROUTES)('applies a stored light choice on %s', (path) => {
    history.replaceState(null, '', path);
    localStorage.setItem(SITE_PALETTE_STORAGE_KEY, 'cream');
    expect(preferredPalette()).toBe('cream');
    applyPalette(preferredPalette());
    expect(document.documentElement.dataset.palette).toBe('cream');
    expect(document.documentElement.dataset.themeLight).toBe('true');
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(document.documentElement.hasAttribute('data-homepage')).toBe(
      path === '/'
    );
    expect(
      document
        .querySelector('meta[name="theme-color"]')
        ?.getAttribute('content')
    ).toBe('#f3efe8');
    expect(sitePalette()).toBe('cream');
  });

  it('lets ?theme= pin a palette over the stored choice', () => {
    localStorage.setItem(SITE_PALETTE_STORAGE_KEY, 'cream');
    history.replaceState(null, '', '/email?theme=dark');
    expect(preferredPalette()).toBe('dark');
    history.replaceState(null, '', '/email?theme=cream');
    localStorage.setItem(SITE_PALETTE_STORAGE_KEY, 'dark');
    expect(preferredPalette()).toBe('cream');
  });

  it('ignores a stored value that is not a palette', () => {
    localStorage.setItem(SITE_PALETTE_STORAGE_KEY, 'sepia');
    expect(preferredPalette()).toBe('dark');
  });

  it('remembers a choice, drops the pin, and applies it at once', () => {
    history.replaceState(null, '', '/pricing?theme=dark&plan=pro');
    choosePalette('cream');
    expect(localStorage.getItem(SITE_PALETTE_STORAGE_KEY)).toBe('cream');
    expect(location.search).toBe('?plan=pro');
    expect(document.documentElement.dataset.palette).toBe('cream');
    expect(preferredPalette()).toBe('cream');

    choosePalette('dark');
    expect(localStorage.getItem(SITE_PALETTE_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.dataset.palette).toBeUndefined();
    expect(sitePalette()).toBe('dark');
  });

  it('still switches when storage is blocked', () => {
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('blocked', 'SecurityError');
      });
    choosePalette('cream');
    expect(document.documentElement.dataset.palette).toBe('cream');
    setItem.mockRestore();
  });

  // The inline scripts run before any stylesheet or module, so they carry
  // their own copy of the policy. It must agree with preferredPalette().
  describe.each(['index.html', 'start.html'])('%s first paint', (entry) => {
    const script = readFileSync(entry, 'utf8').match(
      /<script>\s*\/\/ First-paint palette[\s\S]*?<\/script>/
    )?.[0];

    it.each([
      ['/', undefined, 'dark'],
      ['/email', undefined, 'dark'],
      ['/', 'cream', 'cream'],
      ['/email', 'cream', 'cream'],
      ['/start?theme=cream', undefined, 'cream'],
      ['/email?theme=dark', 'cream', 'dark'],
      ['/email', 'sepia', 'dark'],
    ] as const)('paints %s with %s stored as %s', (url, stored, expected) => {
      expect(script).toBeDefined();
      history.replaceState(null, '', url);
      if (stored) localStorage.setItem(SITE_PALETTE_STORAGE_KEY, stored);
      expect(preferredPalette()).toBe(expected);

      new Function(
        'location',
        'document',
        'localStorage',
        'matchMedia',
        script!.replace(/<\/?script>/g, '')
      )(location, document, localStorage, matchMedia);
      const light = expected === 'cream';
      expect(document.documentElement.dataset.themeLight).toBe(String(light));
      expect(document.documentElement.style.colorScheme).toBe(
        light ? 'light' : 'dark'
      );
      expect(document.documentElement.dataset.palette).toBe(
        light ? 'cream' : undefined
      );
      expect(
        document
          .querySelector('meta[name="theme-color"]')
          ?.getAttribute('content')
      ).toBe(light ? '#f3efe8' : '#000000');
    });

    it('reads the same storage key as the app', () => {
      expect(script).toContain(`'${SITE_PALETTE_STORAGE_KEY}'`);
    });
  });
});
