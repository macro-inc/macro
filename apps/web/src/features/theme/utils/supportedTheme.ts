import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from '../constants';

const RETIRED_LIGHT_THEMES = new Set([
  'Satsuma',
  'Lapis',
  'Flora',
  'Paper',
  'Decepticon',
]);

/** Map retired selections to a maintained theme without discarding saved custom data. */
export function supportedThemeId(
  id: string,
  savedThemes: readonly { id: string; mode: 'light' | 'dark' }[] = []
): string {
  const light =
    id === DEFAULT_LIGHT_THEME ||
    RETIRED_LIGHT_THEMES.has(id) ||
    savedThemes.find((theme) => theme.id === id)?.mode === 'light';
  return light ? DEFAULT_LIGHT_THEME : DEFAULT_DARK_THEME;
}
