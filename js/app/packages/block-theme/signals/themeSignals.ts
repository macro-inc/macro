import { createEffect, createMemo, createSignal } from 'solid-js';
import { convertThemev0v1 } from '../utils/themeMigrations';
import type { ThemeV0, ThemeV1 } from '../types/themeTypes';
import { makePersisted } from '@solid-primitives/storage';
import { DEFAULT_THEMES } from '../constants';

export const [isThemeSaved, setIsThemeSaved] = createSignal<boolean>(true);

export const [themeUpdate, setThemeUpdate] = createSignal<number>(1);

export const [htmlColor, setHtmlColor] = makePersisted(
  createSignal({ color: '' }),
  { name: 'html-color-theme' }
);

export const [userThemes, setUserThemes] = makePersisted(createSignal<ThemeV1[]>([]), {name: 'macro-user-themes'});
setUserThemes(
  userThemes().map((theme) => {
    if (!theme.version) { return convertThemev0v1(theme as unknown as ThemeV0) }
    else { return theme }
  })
);

let convertedDefaultThemes = DEFAULT_THEMES.map((theme) => {
  if (!theme.version) { return convertThemev0v1(theme as unknown as ThemeV0) }
  else { return theme }
});

export const [currentThemeId, setCurrentThemeId] = makePersisted(
  createSignal<string>('Macro'),
  { name: 'macro-selected-theme' }
);

export const themes = createMemo(() => [
  ...convertedDefaultThemes,
  ...userThemes(),
]);

export const [lightModeTheme, setLightModeTheme] = makePersisted(
  createSignal<string>('micro'),
  { name: 'macro-light-mode-theme' }
);

export const [darkModeTheme, setDarkModeTheme] = makePersisted(
  createSignal<string>('macro'),
  { name: 'macro-dark-mode-theme' }
);

export const [themeShouldMatchSystem, setThemeShouldMatchSystem] = makePersisted(
  createSignal<boolean>(false),
  {name: 'macro-theme-should-match-system'}
);

export const [monochromeIcons, setMonochromeIcons] = makePersisted(
  createSignal<boolean>(false),
  { name: 'enable-monochrome-icons' }
);

createEffect(() => {
  if (monochromeIcons()) {
    document.documentElement.style.setProperty( '--theme-contact', 'var(--c0)' );
    document.documentElement.style.setProperty( '--theme-canvas' , 'var(--c0)' );
    document.documentElement.style.setProperty( '--theme-folder' , 'var(--c0)' );
    document.documentElement.style.setProperty( '--theme-image'  , 'var(--c0)' );
    document.documentElement.style.setProperty( '--theme-write'  , 'var(--c0)' );
    document.documentElement.style.setProperty( '--theme-video'  , 'var(--c0)' );
    document.documentElement.style.setProperty( '--theme-html'   , 'var(--c0)' );
    document.documentElement.style.setProperty( '--theme-note'   , 'var(--c0)' );
    document.documentElement.style.setProperty( '--theme-code'   , 'var(--c0)' );
    document.documentElement.style.setProperty( '--theme-chat'   , 'var(--c0)' );
    document.documentElement.style.setProperty( '--theme-pdf'    , 'var(--c0)' );
    document.documentElement.style.setProperty( '--theme-rss'    , 'var(--c0)' );
  }
  else {
    document.documentElement.style.setProperty( '--theme-folder', 'oklch(var(--a0l) var(--a0c) 240)' );
    document.documentElement.style.setProperty( '--theme-canvas', 'oklch(var(--a0l) var(--a0c)  60)' );
    document.documentElement.style.setProperty( '--theme-write' , 'oklch(var(--a0l) var(--a0c) 260)' );
    document.documentElement.style.setProperty( '--theme-video' , 'oklch(var(--a0l) var(--a0c) 277)' );
    document.documentElement.style.setProperty( '--theme-note'  , 'oklch(var(--a0l) var(--a0c) 293)' );
    document.documentElement.style.setProperty( '--theme-code'  , 'oklch(var(--a0l) var(--a0c) 162)' );
    document.documentElement.style.setProperty( '--theme-chat'  , 'oklch(var(--a0l) var(--a0c) 220)' );
    document.documentElement.style.setProperty( '--theme-image' , 'oklch(var(--a0l) var(--a0c)  95)' );
    document.documentElement.style.setProperty( '--theme-html'  , 'oklch(var(--a0l) var(--a0c)  47)' );
    document.documentElement.style.setProperty( '--theme-rss'   , 'oklch(var(--a0l) var(--a0c) 260)' );
    document.documentElement.style.setProperty( '--theme-pdf'   , 'oklch(var(--a0l) var(--a0c)  25)' );
  }
});
