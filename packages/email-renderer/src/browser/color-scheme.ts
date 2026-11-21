import { applyColorScheme, type ColorScheme } from '../core/css';
import { SIGNATURE_CLASSES } from '../core/signature';
import type { ThemeColorParams } from './colors';

const SIGNATURE_SELECTOR = SIGNATURE_CLASSES.map((name) => `.${name}`).join();

/**
 * Apply the sender's `prefers-color-scheme` rules in `root`'s style sheets for
 * the app theme, not the OS, and decide how to color the body. Returns whether
 * to adapt colors to the theme; false means the white panel.
 *
 * In a dark theme, an email whose dark rules paint a background is shown in
 * that dark design (adapted for contrast) instead of on the white panel. The
 * white panel is a light canvas, so it gets the sender's light rules.
 */
export function applySenderColorScheme(
  root: ParentNode,
  theme: ThemeColorParams,
  adaptColors: boolean
): boolean {
  const sheets = Array.from(root.querySelectorAll('style'), (sheet) => ({
    sheet,
    css: sheet.textContent ?? '',
  }));
  const apply = (scheme: ColorScheme) => {
    let darkBackground = false;
    for (const { sheet, css } of sheets) {
      const applied = applyColorScheme(
        css,
        scheme,
        (query) => matchMedia(query).matches
      );
      sheet.textContent = applied.css;
      darkBackground ||= applied.darkBackground;
    }
    return darkBackground;
  };
  if (theme.inkL <= theme.panelL) {
    apply('light');
    return adaptColors;
  }
  if (apply('dark')) return true;
  if (!adaptColors) apply('light');
  return adaptColors;
}

/** True when a table outside the signature lays out the email. */
export function hasLayoutTable(root: ParentNode): boolean {
  return Array.from(root.querySelectorAll('table')).some(
    (table) => !table.closest(SIGNATURE_SELECTOR)
  );
}
