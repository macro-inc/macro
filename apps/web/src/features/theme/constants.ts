import { DEFAULT_THEMES } from './themes';
import type { ThemeColorMode } from './types/themeTypes';

type DefaultTheme = (typeof DEFAULT_THEMES)[number]['id'];

export const DEFAULT_LIGHT_THEME: DefaultTheme = 'Macro Light';
export const DEFAULT_DARK_THEME: DefaultTheme = 'Macro Dark';
export const DEFAULT_THEME_ID = {
  light: DEFAULT_LIGHT_THEME,
  dark: DEFAULT_DARK_THEME,
} as const satisfies Record<ThemeColorMode, string>;

export { DEFAULT_THEMES };
