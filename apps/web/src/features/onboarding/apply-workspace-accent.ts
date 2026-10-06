import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from '@theme/constants';
import {
  currentThemeId,
  setDarkModeTheme,
  setLightModeTheme,
  systemMode,
  themeMode,
  userThemes,
} from '@theme/signals/themeSignals';
import {
  applyTheme,
  saveTheme,
  updateLiveThemeColorToken,
  updateTheme,
} from '@theme/utils/themeUtils';

/** Fork the built-in palette, never the user's unrelated custom theme. */
export function applyWorkspaceAccent(color: string, userId: string) {
  const mode = themeMode() === 'system' ? systemMode() : themeMode();
  const storageKey = `onboarding-theme:${userId}:${mode}`;
  const existingId = sessionStorage.getItem(storageKey);
  applyTheme(mode === 'dark' ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME);
  updateLiveThemeColorToken('accent', color);
  const name = `My workspace ${mode}`;
  if (existingId && userThemes().some((theme) => theme.id === existingId)) {
    updateTheme(existingId, name);
  } else {
    saveTheme(name);
  }
  const id = currentThemeId();
  sessionStorage.setItem(storageKey, id);
  if (mode === 'dark') setDarkModeTheme(id);
  else setLightModeTheme(id);
  applyTheme(id);
}
