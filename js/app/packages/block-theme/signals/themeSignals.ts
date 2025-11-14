import { makePersisted } from '@solid-primitives/storage';
import { createEffect, createMemo, createSignal } from 'solid-js';
import {
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  DEFAULT_THEMES,
} from '../constants';
import type { ThemeV0, ThemeV1 } from '../types/themeTypes';
import { convertThemev0v1 } from '../utils/themeMigrations';

export const [isThemeSaved, setIsThemeSaved] = createSignal<boolean>(true);

export const [themeUpdate, setThemeUpdate] = createSignal<undefined>(undefined, {equals: () => false});

export const [htmlColor, setHtmlColor] = makePersisted(
  createSignal({ color: '' }),
  {name: 'html-color-theme'}
);

export const [userThemes, setUserThemes] = makePersisted(
  createSignal<ThemeV1[]>([]),
  {name: 'macro-user-themes'}
);
setUserThemes(
  userThemes().map((theme) => {
    if(!theme.version){return convertThemev0v1(theme as unknown as ThemeV0)}
    else{return theme}
  })
);

let convertedDefaultThemes = DEFAULT_THEMES.map((theme) => {
  if(!theme.version){return convertThemev0v1(theme as unknown as ThemeV0)}
  else{return theme}
});

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

export const themes = createMemo(() => [...convertedDefaultThemes, ...userThemes()]);

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

export const [systemMode, setSystemMode] = createSignal<'dark' | 'light'>(
  window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
);

const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
darkModeQuery.addEventListener('change', (e: MediaQueryListEvent) => {
  setSystemMode(e.matches ? 'dark' : 'light');
});

export const [monochromeIcons, setMonochromeIcons] = makePersisted(
  createSignal<boolean>(false),
  {name: 'enable-monochrome-icons'}
);

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
  }
  else{
    document.documentElement.style.setProperty( '--theme-folder', 'oklch(var(--a0l) var(--a0c) 240)');
    document.documentElement.style.setProperty( '--theme-canvas', 'oklch(var(--a0l) var(--a0c)  60)');
    document.documentElement.style.setProperty( '--theme-write' , 'oklch(var(--a0l) var(--a0c) 260)');
    document.documentElement.style.setProperty( '--theme-video' , 'oklch(var(--a0l) var(--a0c) 277)');
    document.documentElement.style.setProperty( '--theme-note'  , 'oklch(var(--a0l) var(--a0c) 293)');
    document.documentElement.style.setProperty( '--theme-code'  , 'oklch(var(--a0l) var(--a0c) 162)');
    document.documentElement.style.setProperty( '--theme-chat'  , 'oklch(var(--a0l) var(--a0c) 220)');
    document.documentElement.style.setProperty( '--theme-image' , 'oklch(var(--a0l) var(--a0c)  95)');
    document.documentElement.style.setProperty( '--theme-html'  , 'oklch(var(--a0l) var(--a0c)  47)');
    document.documentElement.style.setProperty( '--theme-rss'   , 'oklch(var(--a0l) var(--a0c) 260)');
    document.documentElement.style.setProperty( '--theme-pdf'   , 'oklch(var(--a0l) var(--a0c)  25)');
  }
});
