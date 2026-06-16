import { DEFAULT_DARK_THEME, DEFAULT_THEMES } from '../constants';
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
