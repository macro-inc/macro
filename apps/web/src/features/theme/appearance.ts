import type { ThemeColorMode } from './types/themeTypes';

export type ThemeMode = ThemeColorMode | 'system';

export type AppearancePreference = {
  mode: ThemeMode;
  themeId: Readonly<Record<ThemeColorMode, string>>;
};

export type ResolvedTheme = {
  scheme: ThemeColorMode;
  themeId: string;
};

export type ChromeAppearance = {
  scheme: ThemeColorMode;
  surface: string;
};

export const APPEARANCE_KEYS = {
  mode: 'macro-theme-mode',
  themeId: {
    light: 'macro-light-mode-theme',
    dark: 'macro-dark-mode-theme',
  },
  surface: 'html-color-theme',
} as const;

export const DEFAULT_SURFACE = {
  light: 'oklch(0.964 0 59deg)',
  dark: 'oklch(0.14 0 59deg)',
} as const satisfies Record<ThemeColorMode, string>;

export function resolveAppearance(
  preference: AppearancePreference,
  system: ThemeColorMode
): ResolvedTheme {
  const scheme = preference.mode === 'system' ? system : preference.mode;
  return { scheme, themeId: preference.themeId[scheme] };
}

function parseStoredValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function parseThemeMode(raw: string | null | undefined): ThemeMode {
  if (raw == null) return 'system';
  const value = parseStoredValue(raw);
  return value === 'light' || value === 'dark' || value === 'system'
    ? value
    : 'system';
}

export function parseThemeId(
  raw: string | null | undefined,
  fallback: string
): string {
  if (raw == null) return fallback;
  const value = parseStoredValue(raw);
  return typeof value === 'string' && value.trim() ? value : fallback;
}

export function parseSurfaceCache(
  raw: string | null | undefined
): Record<ThemeColorMode, string> {
  if (raw == null) return { ...DEFAULT_SURFACE };
  const value = parseStoredValue(raw);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ...DEFAULT_SURFACE };
  }

  const cache = value as Record<string, unknown>;
  return {
    light:
      typeof cache.light === 'string' && cache.light.trim()
        ? cache.light
        : DEFAULT_SURFACE.light,
    dark:
      typeof cache.dark === 'string' && cache.dark.trim()
        ? cache.dark
        : DEFAULT_SURFACE.dark,
  };
}

export function readOsScheme(query: { matches: boolean }): ThemeColorMode {
  return query.matches ? 'dark' : 'light';
}

export function paintChrome(
  chrome: ChromeAppearance,
  doc: Document = document
): void {
  doc.documentElement.style.colorScheme = chrome.scheme;
  doc.documentElement.style.backgroundColor = chrome.surface;
  if (doc.body) doc.body.style.backgroundColor = chrome.surface;
  doc
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', chrome.surface);
}
