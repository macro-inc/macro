import { makePersisted } from '@solid-primitives/storage';
import { createMemo, createSignal } from 'solid-js';
import {
  APPEARANCE_KEYS,
  DEFAULT_SURFACE,
  parseSurfaceCache,
  parseThemeId,
  parseThemeMode,
  readOsScheme,
  type ThemeMode,
} from '../appearance';
import { DEFAULT_THEME_ID, DEFAULT_THEMES } from '../constants';
import type {
  ThemeColorMode,
  ThemeColorTokens,
  ThemeV0,
  ThemeV1,
  ThemeV3,
} from '../types/themeTypes';
import {
  convertThemev0v1,
  convertThemev1v2,
  convertThemev2v3,
} from '../utils/themeMigrations';
import { isThemeV2, isThemeV3 } from '../utils/themeValidation';
import { normalizeThemeColorTokens } from '../utils/themeVNext';

export type { ThemeMode } from '../appearance';

export const [isThemeSaved, setIsThemeSaved] = createSignal<boolean>(true);

export const [themeUpdate, setThemeUpdate] = createSignal<undefined>(
  undefined,
  { equals: () => false }
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
  createSignal<string>(DEFAULT_THEME_ID.dark),
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

export const [lightModeTheme, setLightModeTheme] = makePersisted(
  createSignal<string>(DEFAULT_THEME_ID.light),
  {
    name: APPEARANCE_KEYS.themeId.light,
    deserialize: (raw) => parseThemeId(raw, DEFAULT_THEME_ID.light),
  }
);

export const [darkModeTheme, setDarkModeTheme] = makePersisted(
  createSignal<string>(DEFAULT_THEME_ID.dark),
  {
    name: APPEARANCE_KEYS.themeId.dark,
    deserialize: (raw) => parseThemeId(raw, DEFAULT_THEME_ID.dark),
  }
);

export const [surfaceCache, setSurfaceCache] = makePersisted(
  createSignal<Record<ThemeColorMode, string>>({ ...DEFAULT_SURFACE }),
  {
    name: APPEARANCE_KEYS.surface,
    deserialize: parseSurfaceCache,
  }
);

function initialThemeMode(): ThemeMode {
  if (typeof localStorage === 'undefined') {
    return 'system';
  }
  // The old boolean key opted out of OS follow only when it was the string
  // `'false'`. Missing, `'true'`, or any other value still means system.
  const legacy = localStorage.getItem('macro-theme-should-match-system');
  if (legacy !== 'false') {
    return 'system';
  }
  const pinned = themes().find((theme) => theme.id === currentThemeId());
  if (!pinned) {
    return 'system';
  }
  return pinned.mode;
}

export const [themeMode, setThemeMode] = makePersisted(
  createSignal<ThemeMode>(initialThemeMode()),
  {
    name: APPEARANCE_KEYS.mode,
    deserialize: parseThemeMode,
  }
);

// First-paint cannot rerun initialThemeMode(). Persist the resolved default
// so the next cold load matches Solid. setThemeMode(same) does not write.
if (
  typeof localStorage !== 'undefined' &&
  localStorage.getItem(APPEARANCE_KEYS.mode) === null
) {
  localStorage.setItem(APPEARANCE_KEYS.mode, JSON.stringify(themeMode()));
}

const supportsMatchMedia =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function';

export const [systemMode, setSystemMode] = createSignal<ThemeColorMode>(
  supportsMatchMedia
    ? readOsScheme(window.matchMedia('(prefers-color-scheme: dark)'))
    : 'light'
);

if (supportsMatchMedia) {
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', (event) => {
      setSystemMode(readOsScheme(event));
    });
}

export const [showLightThemes, setShowLightThemes] = makePersisted(
  createSignal<boolean>(true),
  { name: 'macro-show-light-themes' }
);
export const [showDarkThemes, setShowDarkThemes] = makePersisted(
  createSignal<boolean>(true),
  { name: 'macro-show-dark-themes' }
);

export const [themeDepth, setThemeDepth] = createSignal<number>(0.15);
