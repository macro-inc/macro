import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME, DEFAULT_THEMES } from '../constants';
import { createEffect, createMemo, createSignal } from 'solid-js';
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

export const [currentThemeId, setCurrentThemeId_] = makePersisted(
  createSignal<string>(DEFAULT_DARK_THEME),
  {name: 'macro-selected-theme'}
);

// If theme should match system, when we set current theme, we also set the corresponding mode's theme
// This avoids the issue where a user sets a theme, and then refreshes, and gets reverted to their preferred mode's theme.
export const setCurrentThemeId = ( ...args: Parameters<typeof setCurrentThemeId_> ) => {
  setCurrentThemeId_(...args);
  if(themeShouldMatchSystem()){
    systemMode() === 'dark' ? setDarkModeTheme(...args) : setLightModeTheme(...args);
  }
};

export const themes = createMemo(() => [...DEFAULT_THEMES, ...userThemes()]);

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

export const [monochromeIcons, setMonochromeIcons] = makePersisted(
  createSignal<boolean>(false),
  {name: 'enable-monochrome-icons'}
);

export const [themeDepth, setThemeDepth] = createSignal<number>(0.15);


createEffect(() => {
  if(monochromeIcons()){
    document.documentElement.style.setProperty('--theme-contact', 'var(--c0)');
    document.documentElement.style.setProperty('--theme-canvas' , 'var(--c0)');
    document.documentElement.style.setProperty('--theme-folder' , 'var(--c0)');
    document.documentElement.style.setProperty('--theme-image'  , 'var(--c0)');
    document.documentElement.style.setProperty('--theme-write'  , 'var(--c0)');
    document.documentElement.style.setProperty('--theme-video'  , 'var(--c0)');
    document.documentElement.style.setProperty('--theme-html'   , 'var(--c0)');
    document.documentElement.style.setProperty('--theme-note'   , 'var(--c0)');
    document.documentElement.style.setProperty('--theme-code'   , 'var(--c0)');
    document.documentElement.style.setProperty('--theme-chat'   , 'var(--c0)');
    document.documentElement.style.setProperty('--theme-pdf'    , 'var(--c0)');
    document.documentElement.style.setProperty('--theme-rss'    , 'var(--c0)');
    document.documentElement.style.setProperty('--theme-task'   , 'var(--c0)');
  }
  else{
    document.documentElement.style.setProperty( '--theme-folder', 'oklch(var(--a0l) var(--a0c) 240)');
    document.documentElement.style.setProperty( '--theme-canvas', 'oklch(var(--a0l) var(--a0c)  60)');
    document.documentElement.style.setProperty( '--theme-write' , 'oklch(var(--a0l) var(--a0c) 260)');
    document.documentElement.style.setProperty( '--theme-video' , 'oklch(var(--a0l) var(--a0c) 277)');
    document.documentElement.style.setProperty( '--theme-note'  , 'oklch(var(--a0l) var(--a0c) 293)');
    document.documentElement.style.setProperty( '--theme-code'  , 'oklch(var(--a0l) var(--a0c) 180)');
    document.documentElement.style.setProperty( '--theme-chat'  , 'oklch(var(--a0l) var(--a0c) 220)');
    document.documentElement.style.setProperty( '--theme-image' , 'oklch(var(--a0l) var(--a0c)  95)');
    document.documentElement.style.setProperty( '--theme-html'  , 'oklch(var(--a0l) var(--a0c)  47)');
    document.documentElement.style.setProperty( '--theme-rss'   , 'oklch(var(--a0l) var(--a0c) 260)');
    document.documentElement.style.setProperty( '--theme-task'  , 'oklch(var(--a0l) var(--a0c) 150)');
    document.documentElement.style.setProperty( '--theme-pdf'   , 'oklch(var(--a0l) var(--a0c)  25)');
  }
});
