/**
 * What every Pierre diff in the app shares: Macro's light/dark state as a
 * signal, and the CSS variables Pierre reads inside its shadow DOM.
 */

import { type Accessor, createSignal, type JSX, onCleanup } from 'solid-js';

export type ThemeType = 'light' | 'dark';

/** Points Pierre at Macro's mono typography so diffs match the text around them. */
export const PIERRE_STYLE_VARIABLES: JSX.CSSProperties = {
  '--diffs-font-family': 'var(--font-mono)',
  '--diffs-font-size': '0.75rem',
  '--diffs-line-height': '18px',
  '--diffs-tab-size': '2',
  '--diffs-gap-block': '0',
  '--diffs-min-number-column-width': '4ch',
};

/**
 * Pierre's colour overrides pointed at Macro's tokens, so a diff sits on its
 * card's surface and tints changes with the app's success and failure hues.
 * Tints are mixed onto `--color-surface` rather than using the translucent
 * `*-bg` tokens, because Pierre paints its theme background underneath.
 * Syntax colours still come from Pierre's light and dark themes.
 */
export const PIERRE_APP_COLORS: JSX.CSSProperties = {
  '--diffs-addition-color-override': 'var(--color-success)',
  '--diffs-deletion-color-override': 'var(--color-failure)',
  '--diffs-modified-color-override': 'var(--color-accent)',
  '--diffs-bg-context-override': 'var(--color-surface)',
  '--diffs-bg-context-gutter-override': 'var(--color-surface)',
  '--diffs-bg-buffer-override': 'var(--color-surface)',
  '--diffs-bg-separator-override': 'var(--color-inset)',
  '--diffs-bg-addition-override':
    'color-mix(in oklch, var(--color-success) 15%, var(--color-surface))',
  '--diffs-bg-addition-number-override':
    'color-mix(in oklch, var(--color-success) 22%, var(--color-surface))',
  '--diffs-bg-deletion-override':
    'color-mix(in oklch, var(--color-failure) 15%, var(--color-surface))',
  '--diffs-bg-deletion-number-override':
    'color-mix(in oklch, var(--color-failure) 22%, var(--color-surface))',
  '--diffs-fg-number-override': 'var(--color-ink-subtle)',
};

function currentThemeType(): ThemeType {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset.themeLight === 'false'
    ? 'dark'
    : 'light';
}

/**
 * Tracked off the `data-theme-light` attribute the theme feature keeps on
 * `<html>`, instead of Pierre's OS-preference "system" mode.
 */
export function createThemeType(): Accessor<ThemeType> {
  const [themeType, setThemeType] = createSignal<ThemeType>(currentThemeType());
  if (
    typeof document !== 'undefined' &&
    typeof MutationObserver !== 'undefined'
  ) {
    const observer = new MutationObserver(() =>
      setThemeType(currentThemeType())
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme-light'],
    });
    onCleanup(() => observer.disconnect());
  }
  return themeType;
}
