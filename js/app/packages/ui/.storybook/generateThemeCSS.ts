import {
  DEFAULT_DARK_THEME,
  DEFAULT_THEMES,
} from '../../block-theme/constants';
import type { ThemeV1 } from '../../block-theme/types/themeTypes';

/**
 * Converts a theme name to a CSS class name.
 * E.g., "Macro Dark" -> "theme-macro-dark"
 */
export function themeToClassName(themeName: string): string {
  return `theme-${themeName.toLowerCase().replace(/\s+/g, '-')}`;
}

/**
 * Generates CSS variable declarations from theme tokens.
 */
function generateTokenVars(tokens: ThemeV1['tokens']): string {
  return Object.entries(tokens)
    .map(([key, value]) => {
      const { l, c, h } = value;
      return `  --${key}l: ${l}; --${key}c: ${c}; --${key}h: ${h}deg;`;
    })
    .join('\n');
}

/**
 * Converts a theme definition to CSS variable declarations.
 */
export function themeToCSS(theme: ThemeV1): string {
  const className = themeToClassName(theme.name);
  return `.${className} {\n${generateTokenVars(theme.tokens)}\n}`;
}

/**
 * Generates default :root CSS with the default dark theme.
 * This ensures CSS variables are always available even without a theme class.
 */
export function generateRootThemeCSS(): string {
  const defaultTheme = DEFAULT_THEMES.find(
    (t) => t.name === DEFAULT_DARK_THEME
  );
  if (!defaultTheme) return '';
  return `:root {\n${generateTokenVars(defaultTheme.tokens)}\n}`;
}

/**
 * Generates CSS for all default themes, including :root defaults.
 */
export function generateAllThemesCSS(): string {
  const rootCSS = generateRootThemeCSS();
  const themeCSS = DEFAULT_THEMES.map((theme) => themeToCSS(theme)).join(
    '\n\n'
  );
  return `${rootCSS}\n\n${themeCSS}`;
}

/**
 * Generates a mapping of theme names to CSS class names.
 * E.g., { "Macro Dark": "theme-macro-dark", ... }
 */
export function generateThemeClassMapping(): Record<string, string> {
  return Object.fromEntries(
    DEFAULT_THEMES.map((theme) => [theme.name, themeToClassName(theme.name)])
  );
}
