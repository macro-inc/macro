import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APPEARANCE_KEYS,
  DEFAULT_SURFACE,
  paintChrome,
  parseSurfaceCache,
  parseThemeId,
  parseThemeMode,
  readOsScheme,
  resolveAppearance,
  type ThemeMode,
} from './appearance';
import { DEFAULT_THEME_ID, DEFAULT_THEMES } from './constants';
import type { ThemeColorMode } from './types/themeTypes';

const THEME_ID = {
  light: 'Light theme',
  dark: 'Dark theme',
} as const;

describe('resolveAppearance', () => {
  it.each([
    ['light', 'light', 'light', 'Light theme'],
    ['light', 'dark', 'light', 'Light theme'],
    ['dark', 'light', 'dark', 'Dark theme'],
    ['dark', 'dark', 'dark', 'Dark theme'],
    ['system', 'light', 'light', 'Light theme'],
    ['system', 'dark', 'dark', 'Dark theme'],
  ] satisfies Array<[ThemeMode, ThemeColorMode, ThemeColorMode, string]>)(
    '%s mode on a %s system resolves to %s',
    (mode, system, scheme, themeId) => {
      expect(resolveAppearance({ mode, themeId: THEME_ID }, system)).toEqual({
        scheme,
        themeId,
      });
    }
  );
});

describe('storage parsers', () => {
  it.each([
    ['"dark"', 'dark'],
    ['light', 'light'],
    ['"system"', 'system'],
    ['"sepia"', 'system'],
    ['garbage', 'system'],
    [null, 'system'],
  ] satisfies Array<[string | null, ThemeMode]>)(
    'parses theme mode %s',
    (raw, expected) => {
      expect(parseThemeMode(raw)).toBe(expected);
    }
  );

  it('accepts quoted and bare theme ids and rejects malformed values', () => {
    expect(parseThemeId('"Ocean Dark"', 'Macro Dark')).toBe('Ocean Dark');
    expect(parseThemeId('Ocean Dark', 'Macro Dark')).toBe('Ocean Dark');
    expect(parseThemeId('""', 'Macro Dark')).toBe('Macro Dark');
    expect(parseThemeId('{"id":"Ocean Dark"}', 'Macro Dark')).toBe(
      'Macro Dark'
    );
    expect(parseThemeId(null, 'Macro Dark')).toBe('Macro Dark');
  });

  it('fills missing and invalid surface cache values from defaults', () => {
    expect(APPEARANCE_KEYS.surface).toBe('html-color-theme');
    expect(
      parseSurfaceCache(
        JSON.stringify({ light: 'light surface', dark: 'dark surface' })
      )
    ).toEqual({ light: 'light surface', dark: 'dark surface' });
    expect(parseSurfaceCache(JSON.stringify({ dark: 'custom dark' }))).toEqual({
      light: DEFAULT_SURFACE.light,
      dark: 'custom dark',
    });
    expect(parseSurfaceCache('garbage')).toEqual(DEFAULT_SURFACE);
    expect(parseSurfaceCache('{"color":"legacy surface"}')).toEqual(
      DEFAULT_SURFACE
    );
    expect(parseSurfaceCache('{"light":42,"dark":""}')).toEqual(
      DEFAULT_SURFACE
    );
    expect(parseSurfaceCache(null)).toEqual(DEFAULT_SURFACE);
  });
});

it('matches the built-in desktop surface-0 values', () => {
  const light = DEFAULT_THEMES.find(
    (theme) => theme.id === DEFAULT_THEME_ID.light
  );
  const dark = DEFAULT_THEMES.find(
    (theme) => theme.id === DEFAULT_THEME_ID.dark
  );

  expect(light?.colorTokens['surface-0']).toBe(DEFAULT_SURFACE.light);
  expect(dark?.colorTokens['surface-0']).toBe(DEFAULT_SURFACE.dark);
});

it('maps matchMedia.matches onto a color scheme', () => {
  expect(readOsScheme({ matches: true })).toBe('dark');
  expect(readOsScheme({ matches: false })).toBe('light');
});

function createChromeDocument(): Document {
  const doc = document.implementation.createHTMLDocument('Appearance test');
  doc.head.innerHTML = '<meta name="theme-color" content="#FFFFFF">';
  return doc;
}

function chromeState(doc: Document) {
  return {
    colorScheme: doc.documentElement.style.colorScheme,
    htmlBackground: doc.documentElement.style.backgroundColor,
    bodyBackground: doc.body.style.backgroundColor,
    themeColor: doc
      .querySelector('meta[name="theme-color"]')
      ?.getAttribute('content'),
  };
}

it('paints browser chrome idempotently', () => {
  const doc = createChromeDocument();
  const chrome = { scheme: 'dark', surface: DEFAULT_SURFACE.dark } as const;

  paintChrome(chrome, doc);
  const once = chromeState(doc);
  paintChrome(chrome, doc);

  expect(chromeState(doc)).toEqual(once);
  expect(once.colorScheme).toBe('dark');
  expect(once.themeColor).toBe(DEFAULT_SURFACE.dark);
});

describe('first-paint script', () => {
  const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const scriptMatch = indexHtml.match(
    /<script id="first-paint-appearance">([\s\S]*?)<\/script>/
  );

  it.each([
    {
      mode: JSON.stringify('system'),
      surface: JSON.stringify({
        light: 'oklch(0.9 0 0deg)',
        dark: 'oklch(0.1 0 0deg)',
      }),
      system: 'dark',
    },
    {
      mode: 'light',
      surface: JSON.stringify({
        light: 'oklch(0.8 0 0deg)',
        dark: 'oklch(0.2 0 0deg)',
      }),
      system: 'dark',
    },
    {
      mode: '"sepia"',
      surface: 'garbage',
      system: 'light',
    },
    {
      mode: undefined,
      surface: undefined,
      system: 'dark',
    },
  ] satisfies Array<{
    mode: string | undefined;
    surface: string | undefined;
    system: ThemeColorMode;
  }>)(
    'agrees with the module for mode $mode on a $system system',
    ({ mode, surface, system }) => {
      expect(scriptMatch?.[1]).toBeTruthy();
      if (!scriptMatch?.[1]) return;

      const storage = new Map<string, string>();
      if (mode !== undefined) storage.set(APPEARANCE_KEYS.mode, mode);
      if (surface !== undefined) {
        storage.set(APPEARANCE_KEYS.surface, surface);
      }

      const actual = createChromeDocument();
      Function(
        'window',
        'document',
        'localStorage',
        scriptMatch[1]
      )(
        {
          matchMedia: () => ({ matches: system === 'dark' }),
        },
        actual,
        {
          getItem: (key: string) => storage.get(key) ?? null,
        }
      );

      const expected = createChromeDocument();
      const resolved = resolveAppearance(
        {
          mode: parseThemeMode(mode),
          themeId: DEFAULT_THEME_ID,
        },
        system
      );
      const surfaces = parseSurfaceCache(surface);
      paintChrome(
        { scheme: resolved.scheme, surface: surfaces[resolved.scheme] },
        expected
      );

      expect(chromeState(actual)).toEqual(chromeState(expected));
    }
  );
});
