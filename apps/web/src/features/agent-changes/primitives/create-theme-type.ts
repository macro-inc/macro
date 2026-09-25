/**
 * Macro's light/dark state as a signal for Pierre, tracked off the
 * `data-theme-light` attribute the theme feature keeps on `<html>`.
 */

import { type Accessor, createSignal, onCleanup } from 'solid-js';

export type ThemeType = 'light' | 'dark';

function currentThemeType(): ThemeType {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset.themeLight === 'false'
    ? 'dark'
    : 'light';
}

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
