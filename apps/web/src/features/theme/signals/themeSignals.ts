import { makePersisted } from '@solid-primitives/storage';
import { createMemo, createSignal } from 'solid-js';
import {
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  DEFAULT_THEMES,
} from '../constants';
import type {
  ThemeColorTokens,
  ThemeV0,
  ThemeV1,
  ThemeV3,
} from '../types/themeTypes';
import { normalizeThemeColorTokens } from '../utils/themeColorTokens';
import {
  convertThemev0v1,
  convertThemev1v2,
  convertThemev2v3,
} from '../utils/themeMigrations';
import { isThemeV2, isThemeV3 } from '../utils/themeValidation';

export const [isThemeSaved, setIsThemeSaved] = createSignal<boolean>(true);

export const [themeUpdate, setThemeUpdate] = createSignal<undefined>(
  undefined,
  { equals: () => false }
);

export const [htmlColor, setHtmlColor] = makePersisted(
  createSignal({ color: '' }),
  { name: 'html-color-theme' }
);

export const [userThemes, setUserThemes] = makePersisted(
  createSignal<ThemeV3[]>([]),
  { name: 'macro-user-themes' }
);
setUserThemes(
  (userThemes() as unknown[]).flatMap((theme) => {
    if (isThemeV3(theme)) {
      return [
        {
          ...theme,
          colorTokens: normalizeThemeColorTokens(theme.colorTokens, theme.mode),
        },
      ];
    }
    if (isThemeV2(theme)) return [convertThemev2v3(theme)];
    if (typeof theme !== 'object' || theme === null) return [];

    const version = (theme as { version?: unknown }).version;
    if (version === 1) {
      return [convertThemev2v3(convertThemev1v2(theme as ThemeV1))];
    }
    if (version === undefined || version === 0) {
      return [
        convertThemev2v3(convertThemev1v2(convertThemev0v1(theme as ThemeV0))),
      ];
    }
    return [];
  })
);

export const [currentThemeId, setCurrentThemeId] = makePersisted(
  createSignal<string>(DEFAULT_DARK_THEME),
  { name: 'macro-selected-theme' }
);

export const themes = createMemo<ThemeV3[]>(() => [
  ...DEFAULT_THEMES,
  ...userThemes(),
]);

/** VNext colors currently rendered and edited in the document. */
export const [themeColorTokens, setThemeColorTokens] =
  createSignal<ThemeColorTokens>({});

/** Intrinsic mode of the currently rendered theme. */
export const [liveThemeMode, setLiveThemeMode] = createSignal<'light' | 'dark'>(
  'dark'
);

// Per-mode theme preferences, persisted to localStorage. The active one is
// applied by systemThemeEffect / resolveActiveThemeId (themeUtils.ts): the light
// theme when themeMode is 'light' (or 'system' + OS light), the dark theme when
// 'dark' (or 'system' + OS dark).
export const [lightModeTheme, setLightModeTheme] = makePersisted(
  createSignal<string>(DEFAULT_LIGHT_THEME),
  { name: 'macro-light-mode-theme' }
);

export const [darkModeTheme, setDarkModeTheme] = makePersisted(
  createSignal<string>(DEFAULT_DARK_THEME),
  { name: 'macro-dark-mode-theme' }
);

/** The "Active theme" mode: pin a fixed light or dark theme, or follow the OS
 *  ('system'). Drives which per-mode theme (lightModeTheme/darkModeTheme) is
 *  live — see resolveActiveThemeId / systemThemeEffect in themeUtils. */
export type ThemeMode = 'light' | 'dark' | 'system';

/** Fallback for the initial themeMode, migrating the pre-"Active theme" setting
 *  (`macro-theme-should-match-system`) so returning users keep their appearance:
 *  auto-detect on → 'system'; auto-detect off (a pinned theme) → the fixed
 *  light/dark mode matching the previously-selected theme. Only used until the
 *  new `macro-theme-mode` key is written. */
function initialThemeMode(): ThemeMode {
  if (typeof localStorage === 'undefined') {
    return 'system';
  }
  const legacy = localStorage.getItem('macro-theme-should-match-system');
  // New/already-migrated users, and anyone who had auto-detect on: follow the OS.
  if (legacy !== 'false') {
    return 'system';
  }
  // Auto-detect was off: pin to the mode matching the previously-selected theme
  // based on the explicit mode stored by V3.
  const pinned = themes().find((theme) => theme.id === currentThemeId());
  if (!pinned) {
    return 'system';
  }
  return pinned.mode;
}

export const [themeMode, setThemeMode] = makePersisted(
  createSignal<ThemeMode>(initialThemeMode()),
  { name: 'macro-theme-mode' }
);

const supportsMatchMedia =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function';

// Tracks the OS color scheme so the active theme can follow it when themeMode is
// 'system'.
export const [systemMode, setSystemMode] = createSignal<'dark' | 'light'>(
  supportsMatchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
);

if (supportsMatchMedia) {
  const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  darkModeQuery.addEventListener('change', (e: MediaQueryListEvent) => {
    setSystemMode(e.matches ? 'dark' : 'light');
  });
}

// Theme-list filters: whether light and/or dark themes are shown in the list.
export const [showLightThemes, setShowLightThemes] = makePersisted(
  createSignal<boolean>(true),
  { name: 'macro-show-light-themes' }
);
export const [showDarkThemes, setShowDarkThemes] = makePersisted(
  createSignal<boolean>(true),
  { name: 'macro-show-dark-themes' }
);

export const [themeDepth, setThemeDepth] = createSignal<number>(0.15);
