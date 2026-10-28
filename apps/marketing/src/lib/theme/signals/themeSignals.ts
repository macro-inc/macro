import { makePersisted } from '@solid-primitives/storage';
import { createMemo, createSignal } from 'solid-js';
import { isServer } from 'solid-js/web';
import {
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  DEFAULT_THEMES,
} from '../constants/themeConstants';
import type { ThemeV0, ThemeV1 } from '../types/themeTypes';
import { convertThemev0v1 } from '../utils/themeMigrations';

export const [isThemeSaved, setIsThemeSaved] = createSignal<boolean>(true);

export const [themeUpdate, setThemeUpdate] = createSignal<undefined>(
  undefined,
  { equals: () => false }
);

export const [userThemes, setUserThemes] = makePersisted(
  createSignal<ThemeV1[]>([]),
  { name: 'macro-site-user-themes' }
);
setUserThemes(
  userThemes().map((theme) => {
    if (!theme.version) {
      return convertThemev0v1(theme as unknown as ThemeV0);
    } else {
      return theme;
    }
  })
);

let convertedDefaultThemes = DEFAULT_THEMES.map((theme) => {
  if (!theme.version) {
    return convertThemev0v1(theme as unknown as ThemeV0);
  } else {
    return theme;
  }
});

export const [currentThemeId, setCurrentThemeId_] = makePersisted(
  createSignal<string>(DEFAULT_DARK_THEME),
  { name: 'macro-site-selected-theme' }
);

// If theme should match system, when we set current theme, we also set the corresponding mode's theme
// This avoids the issue where a user sets a theme, and then refreshes, and gets reverted to their preferred mode's theme.
export const setCurrentThemeId = (
  ...args: Parameters<typeof setCurrentThemeId_>
) => {
  setCurrentThemeId_(...args);
  if (themeShouldMatchSystem()) {
    systemMode() === 'dark'
      ? setDarkModeTheme(...args)
      : setLightModeTheme(...args);
  }
};

export const themes = createMemo(() => [
  ...convertedDefaultThemes,
  ...userThemes(),
]);

export const [lightModeTheme, setLightModeTheme] = makePersisted(
  createSignal<string>(DEFAULT_LIGHT_THEME),
  { name: 'macro-site-light-mode-theme' }
);

export const [darkModeTheme, setDarkModeTheme] = makePersisted(
  createSignal<string>(DEFAULT_DARK_THEME),
  { name: 'macro-site-dark-mode-theme' }
);

export const [themeShouldMatchSystem, setThemeShouldMatchSystem] =
  makePersisted(createSignal<boolean>(true), {
    name: 'macro-site-theme-should-match-system',
  });

export const [systemMode, setSystemMode] = createSignal<'dark' | 'light'>(
  // No window during build-time prerendering; the site defaults to dark.
  isServer || window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
);

if (!isServer) {
  const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  darkModeQuery.addEventListener('change', (e: MediaQueryListEvent) => {
    setSystemMode(e.matches ? 'dark' : 'light');
  });
}
