import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME, DEFAULT_THEMES } from '../constants';
import { createMemo, createSignal } from 'solid-js';
import type { ThemeV0, ThemeV1, ThemeV2 } from '../types/themeTypes';
import { convertThemev0v1, convertThemev1v2 } from '../utils/themeMigrations';
import { makePersisted } from '@solid-primitives/storage';

export const [isThemeSaved, setIsThemeSaved] = createSignal<boolean>(true);

export const [themeUpdate, setThemeUpdate] = createSignal<undefined>(undefined, {equals: () => false});

export const [htmlColor, setHtmlColor] = makePersisted(
  createSignal({ color: '' }),
  {name: 'html-color-theme'}
);

export const [userThemes, setUserThemes] = makePersisted(
  createSignal<ThemeV2[]>([]),
  {name: 'macro-user-themes'}
);
setUserThemes(
  userThemes().map((theme) => {
    if(!theme.version){return convertThemev1v2(convertThemev0v1(theme as unknown as ThemeV0))}
    else if(theme.version === 1){return convertThemev1v2(theme as unknown as ThemeV1)}
    else{return theme}
  })
);

export const [currentThemeId, setCurrentThemeId] = makePersisted(
  createSignal<string>(DEFAULT_DARK_THEME),
  {name: 'macro-selected-theme'}
);

export const themes = createMemo(() => [...DEFAULT_THEMES, ...userThemes()]);

// Per-mode theme preferences, persisted to localStorage. Applied by
// systemThemeEffect (themeUtils.ts) when themeShouldMatchSystem is on and the OS
// color scheme is (or becomes) the matching mode.
export const [lightModeTheme, setLightModeTheme] = makePersisted(
  createSignal<string>(DEFAULT_LIGHT_THEME),
  {name: 'macro-light-mode-theme'}
);

export const [darkModeTheme, setDarkModeTheme] = makePersisted(
  createSignal<string>(DEFAULT_DARK_THEME),
  {name: 'macro-dark-mode-theme'}
);

export const [themeShouldMatchSystem, setThemeShouldMatchSystem] = makePersisted(
  createSignal<boolean>(true),
  {name: 'macro-theme-should-match-system'}
);

const supportsMatchMedia =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function';

// Tracks the OS color scheme so the active theme can follow it when
// themeShouldMatchSystem is on.
export const [systemMode, setSystemMode] = createSignal<'dark' | 'light'>(
  supportsMatchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
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
  {name: 'macro-show-light-themes'}
);
export const [showDarkThemes, setShowDarkThemes] = makePersisted(
  createSignal<boolean>(true),
  {name: 'macro-show-dark-themes'}
);

export const [themeDepth, setThemeDepth] = createSignal<number>(0.15);
