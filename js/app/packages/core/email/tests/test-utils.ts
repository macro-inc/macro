import { DEFAULT_THEMES } from '../../../block-theme/constants';
import type { ThemeColorParams } from '../transform-email-colors';

export interface EmailFixture {
  name: string;
  description: string;
  html: string;
  options?: {
    isPersonal?: boolean;
    hasTable?: boolean;
  };
}

/**
 * Converts a theme name to a CSS class name.
 * E.g., "Macro Dark" -> "theme-macro-dark"
 */
function themeToClassName(themeName: string): string {
  return `theme-${themeName.toLowerCase().replace(/\s+/g, '-')}`;
}

/**
 * Generates CSS variable declarations from theme tokens.
 */
function generateTokenVars(
  tokens: Record<string, { l: number; c: number; h: number }>
): string {
  return Object.entries(tokens)
    .map(([key, value]) => {
      const { l, c, h } = value;
      return `  --${key}l: ${l}; --${key}c: ${c}; --${key}h: ${h}deg;`;
    })
    .join('\n');
}

/**
 * Generates CSS for all default themes.
 */
export function generateAllThemesCSS(): string {
  const themeCSS = DEFAULT_THEMES.map((theme) => {
    const className = themeToClassName(theme.name);
    return `.${className} {\n${generateTokenVars(theme.tokens)}\n}`;
  }).join('\n\n');

  // Also generate :root with the first theme as default
  const defaultTheme = DEFAULT_THEMES[0];
  const rootCSS = `:root {\n${generateTokenVars(defaultTheme.tokens)}\n}`;

  return `${rootCSS}\n\n${themeCSS}`;
}

/**
 * Injects theme CSS into the document.
 */
export function injectThemeCSS(): void {
  const existingStyle = document.getElementById('macro-theme-css');
  if (existingStyle) return;

  const style = document.createElement('style');
  style.id = 'macro-theme-css';
  style.textContent = generateAllThemesCSS();
  document.head.appendChild(style);
}

/**
 * Gets theme color parameters for a given theme name.
 */
export function getThemeConfig(themeName: string): ThemeColorParams {
  const theme = DEFAULT_THEMES.find((t) => t.name === themeName);
  if (!theme) {
    throw new Error(`Theme "${themeName}" not found`);
  }

  return {
    inkL: theme.tokens.c0.l,
    inkC: theme.tokens.c0.c,
    inkH: theme.tokens.c0.h,
    panelL: theme.tokens.b1.l,
    accentL: theme.tokens.a0.l,
    accentC: theme.tokens.a0.c,
    accentH: theme.tokens.a0.h,
  };
}

/**
 * Creates an isolated test container with the specified theme class.
 */
export function createTestContainer(themeName: string): HTMLElement {
  const container = document.createElement('div');
  container.className = `test-container ${themeToClassName(themeName)}`;
  container.style.width = '600px';
  container.style.padding = '16px';
  container.style.backgroundColor = 'var(--b1l, white)';
  return container;
}

/**
 * Loads a fixture from the fixtures directory.
 * Note: In browser tests, fixtures are loaded via fetch.
 */
export async function loadFixture(name: string): Promise<EmailFixture> {
  const response = await fetch(
    `/packages/core/email/test/fixtures/${name}.json`
  );
  if (!response.ok) {
    throw new Error(`Fixture "${name}" not found`);
  }
  return response.json();
}

/**
 * Loads all fixtures from the fixtures directory.
 * Note: This requires a manifest of fixture names.
 */
export async function loadAllFixtures(
  fixtureNames: string[]
): Promise<EmailFixture[]> {
  return Promise.all(fixtureNames.map(loadFixture));
}
