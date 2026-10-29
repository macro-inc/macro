import type { ThemeV3 } from '../types/themeTypes';
import { buttonAccentVars } from './buttonTheme';
import { resolveThemeColors } from './resolvedThemeColors';
import {
  normalizeThemeColorTokens,
  themeTokenCssVar,
} from './themeColorTokens';

/** Render a subtree theme with the same authored and derived values as the root. */
export function themeCssVars(theme: ThemeV3): Record<string, string> {
  const tokens = normalizeThemeColorTokens(theme.colorTokens, theme.mode);
  const vars = buttonAccentVars(resolveThemeColors(tokens, theme.mode));
  for (const [token, value] of Object.entries(tokens)) {
    const mapped = themeTokenCssVar(token, value);
    if (mapped) vars[mapped.name] = mapped.value;
  }
  return vars;
}
