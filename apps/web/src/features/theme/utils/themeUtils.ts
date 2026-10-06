import { toast } from '@core/component/Toast/Toast';
import { batch, createEffect, on } from 'solid-js';
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from '../constants';
import {
  currentThemeId,
  darkModeTheme,
  lightModeTheme,
  liveThemeMode,
  resolvedThemeColors,
  setCommittedThemeAccent,
  setCurrentThemeId,
  setDarkModeTheme,
  setHtmlColor,
  setIsThemeSaved,
  setLightModeTheme,
  setLiveThemeMode,
  setThemeColorTokens,
  setThemeMode,
  setUserThemes,
  systemMode,
  themeColorTokens,
  themeMode,
  themes,
  userThemes,
} from '../signals/themeSignals';
import type { ThemeColorTokens, ThemeV3 } from '../types/themeTypes';
import { formatOklch } from './colorUtil';
import { resolveThemeColors } from './resolvedThemeColors';
import {
  isStructuralThemeToken,
  normalizeThemeColorTokens,
  themeTokenCssVar,
} from './themeColorTokens';
import { convertThemev2v3 } from './themeMigrations';
import { isThemeV2, isThemeV3 } from './themeValidation';

export function exportTheme(themeId?: string) {
  const id = themeId ?? currentThemeId();
  const theme = JSON.stringify(themes().find((t) => t.id === id));
  navigator.clipboard.writeText(theme);
}

async function _importTheme(): Promise<void> {
  try {
    const text = await navigator.clipboard.readText();
    const parsed: unknown = JSON.parse(text);
    const imported = isThemeV3(parsed)
      ? parsed
      : isThemeV2(parsed)
        ? convertThemev2v3(parsed)
        : null;
    if (!imported) {
      toast.alert('Clipboard does not contain a valid theme.');
      return;
    }
    const id = crypto.randomUUID();
    const newTheme: ThemeV3 = {
      id,
      name: imported.name,
      version: 3,
      mode: imported.mode,
      colorTokens: normalizeThemeColorTokens(
        imported.colorTokens,
        imported.mode
      ),
    };
    setUserThemes([...userThemes(), newTheme]);
    applyTheme(id);
  } catch (e) {
    console.error('Failed to import theme:', e);
    toast.alert('Failed to import theme from clipboard.');
  }
}

let renderedColorTokenKeys = new Set<string>();

function renderThemeColorToken(token: string, value: string): void {
  const mapped = themeTokenCssVar(token, value);

  if (isStructuralThemeToken(token)) {
    document.documentElement.style.removeProperty(`--color-${token}`);
  }

  if (mapped) {
    document.documentElement.style.setProperty(mapped.name, mapped.value);
  } else {
    document.documentElement.style.removeProperty(`--theme-${token}`);
  }
}

/** Applies a color token for an editor drag without updating persisted state. */
export function previewLiveThemeColorToken(token: string, value: string): void {
  renderThemeColorToken(token, value);
}

/** Writes all VNext authored tokens to the root and updates editor state. */
export function setLiveThemeColorTokens(tokens: ThemeColorTokens): void {
  const normalizedTokens = normalizeThemeColorTokens(tokens, liveThemeMode());
  // Compute before invalidating styles on the live document.
  const colors = resolveThemeColors(normalizedTokens, liveThemeMode());
  for (const key of renderedColorTokenKeys) {
    if (!(key in normalizedTokens)) {
      document.documentElement.style.removeProperty(`--color-${key}`);
      document.documentElement.style.removeProperty(`--theme-${key}`);
    }
  }
  for (const [key, value] of Object.entries(normalizedTokens)) {
    renderThemeColorToken(key, value);
  }
  renderedColorTokenKeys = new Set(Object.keys(normalizedTokens));
  const root = document.documentElement;
  root.dataset.themeLight = String(
    colors['surface-0'].l > colors['content-0'].l
  );
  if (!normalizedTokens['accent-contrast']) {
    root.style.setProperty(
      '--color-accent-contrast',
      formatOklch({
        ...colors['content-0'],
        l: colors.accent.l < 0.72 ? 0.97 : 0.2,
      })
    );
  }
  root.style.setProperty(
    '--theme-comment-ink-lightness',
    String(colors['content-1'].l)
  );
  setThemeColorTokens(normalizedTokens);
}

/** Updates one authored token immediately; persistence still happens on save. */
export function updateLiveThemeColorToken(token: string, value: string): void {
  const next = { ...themeColorTokens(), [token]: value };
  setLiveThemeColorTokens(next);
  setIsThemeSaved(false);
}

/** The live tokens/overrides as they were when a preview started; restored
 *  when the preview ends. Null while no preview is active. */
let previewSnapshot: {
  colorTokens: ThemeColorTokens;
  mode: 'light' | 'dark';
} | null = null;
let previewEndVersion = 0;

export function applyTheme(id: string): void {
  let theme = themes().find((t) => t.id === id);
  if (!theme) {
    console.error(`theme not found: ${id}`);
    theme = themes().find((t) => t.id === DEFAULT_DARK_THEME)!;
  }
  setCurrentThemeId(theme.id);
  // Committing a theme supersedes any in-flight preview; drop the snapshot so
  // clearThemePreview doesn't revert the commit.
  previewSnapshot = null;

  batch(() => {
    setLiveThemeMode(theme.mode);
    setLiveThemeColorTokens(theme.colorTokens);
  });
  setIsThemeSaved(true);
  syncCommittedColors();
}

/** Temporarily shows a theme (e.g. while it's hovered/highlighted in a picker)
 *  without selecting it: only the live token signals and override CSS vars
 *  change — currentThemeId, saved-state, and the persisted first-paint color
 *  are untouched. Revert with clearThemePreview; committing via applyTheme
 *  makes the preview permanent. */
export function previewTheme(id: string): void {
  const theme = themes().find((t) => t.id === id);
  if (!theme) {
    return;
  }
  previewEndVersion++;
  if (!previewSnapshot) {
    // Snapshot the live tokens (not the selected theme id) so ending the
    // preview restores unsaved in-editor edits too.
    previewSnapshot = {
      colorTokens: { ...themeColorTokens() },
      mode: liveThemeMode(),
    };
  }
  batch(() => {
    setLiveThemeMode(theme.mode);
    setLiveThemeColorTokens(theme.colorTokens);
  });
}

/** A highlight handoff ends the old row before starting the next. Defer only
 * the rollback so a new preview in the same turn retains the original snapshot. */
export function scheduleThemePreviewEnd(): void {
  const version = ++previewEndVersion;
  queueMicrotask(() => {
    if (version === previewEndVersion) clearThemePreview();
  });
}

/** Ends an active theme preview, restoring the pre-preview tokens. No-op when
 *  nothing is being previewed. */
export function clearThemePreview(): void {
  previewEndVersion++;
  if (!previewSnapshot) {
    return;
  }
  const snapshot = previewSnapshot;
  previewSnapshot = null;
  batch(() => {
    setLiveThemeMode(snapshot.mode);
    setLiveThemeColorTokens(snapshot.colorTokens);
  });
}

/** Resolves the theme id that should be live for the current "Active theme"
 *  mode: the pinned light/dark theme, or — in system mode — whichever matches
 *  the OS color scheme. Read inside a reactive scope, it subscribes to the mode,
 *  the OS scheme (system mode only), and the relevant per-mode theme. */
export function resolveActiveThemeId(): string {
  const resolved = themeMode() === 'system' ? systemMode() : themeMode();
  return resolved === 'dark' ? darkModeTheme() : lightModeTheme();
}

/** Keeps the active theme in sync with the "Active theme" mode: applies the
 *  pinned light/dark theme, or follows the OS color scheme in system mode.
 *  Re-applies whenever the mode, the OS scheme, or the *active* mode's theme
 *  changes — but not when the inactive mode's theme changes (that id isn't read
 *  by resolveActiveThemeId, so it isn't tracked). Call once from a reactive root
 *  (see Root.tsx). */
export function systemThemeEffect(): void {
  createEffect(
    on(resolveActiveThemeId, (id) => applyTheme(id), { defer: true })
  );
}

/** Only committed colors affect browser/notification icons and first paint. */
function syncCommittedColors(): void {
  const colors = resolvedThemeColors();
  // index.html reads these before any JS loads to paint the boot shell.
  setHtmlColor({
    color: formatOklch(colors['surface-0']),
    panel: formatOklch(colors['surface-1']),
    ink: formatOklch(colors['content-0']),
  });
  setCommittedThemeAccent(formatOklch(colors.accent));
}

export function saveTheme(name: string): void {
  const id = crypto.randomUUID();
  const newTheme: ThemeV3 = {
    id: id,
    name: name,
    version: 3,
    mode: liveThemeMode(),
    colorTokens: { ...themeColorTokens() },
  };
  setUserThemes([...userThemes(), newTheme]);
  setCurrentThemeId(id);
  setIsThemeSaved(true);
  syncCommittedColors();
}

/** Save the live V3 registry back onto an existing custom theme. */
export function updateTheme(id: string, name: string): void {
  setUserThemes(
    userThemes().map((theme) =>
      theme.id === id
        ? {
            ...theme,
            name,
            mode: liveThemeMode(),
            colorTokens: { ...themeColorTokens() },
          }
        : theme
    )
  );
  setCurrentThemeId(id);
  setIsThemeSaved(true);
  syncCommittedColors();
}

export function deleteTheme(id: string): void {
  setUserThemes(userThemes().filter((theme) => theme.id !== id));
  // A deleted theme can no longer serve as a per-mode default; fall back to the
  // built-in Macro light/dark themes.
  if (lightModeTheme() === id) {
    setLightModeTheme(DEFAULT_LIGHT_THEME);
  }
  if (darkModeTheme() === id) {
    setDarkModeTheme(DEFAULT_DARK_THEME);
  }
  if (currentThemeId() === id) {
    // Keep the live tokens in place so the picker still shows this theme's
    // swatch, but mark it unsaved/unselected — it now reads as "Unsaved Theme"
    // until the user saves it again.
    setIsThemeSaved(false);
    setCurrentThemeId('');
  }
}

/** A synthetic ThemeV3 snapshot of the live (in-editor) tokens. Lets the picker
 *  render a swatch for the active theme even when it isn't a stored theme — e.g.
 *  after the selected theme was deleted, leaving an unsaved live theme. Reading
 *  it inside a reactive scope subscribes to the live token signals. */
export function getLiveTheme(): ThemeV3 {
  return {
    id: '',
    name: 'Unsaved Theme',
    version: 3,
    mode: liveThemeMode(),
    colorTokens: { ...themeColorTokens() },
  };
}

/** Pins a theme as the "Active theme": makes it the stored theme for its
 *  intrinsic light/dark mode and switches the mode to match, so
 *  resolveActiveThemeId / systemThemeEffect apply it live. Shared by the settings
 *  Active-theme picker and the command-palette "Change theme" action so choosing
 *  a theme in either place is reflected in the other. */
export function pinTheme(theme: ThemeV3): void {
  if (theme.mode === 'dark') {
    setDarkModeTheme(theme.id);
    setThemeMode('dark');
  } else {
    setLightModeTheme(theme.id);
    setThemeMode('light');
  }
}

/** Follows the OS color scheme (the "System preference" option): switches the
 *  mode to 'system' and applies whichever per-mode theme the OS currently
 *  resolves to. Shared by the settings picker and the command palette. */
export function applySystemTheme(): void {
  setThemeMode('system');
  applyTheme(resolveActiveThemeId());
}

/** Checks if the theme contrast is too low, and if so, applies a readable theme. This is to prevent malicious actors sending "Theme Viruses" which make a user's theme unusable. */
export function ensureMinimalThemeContrast() {
  const colors = resolvedThemeColors();
  const surface = colors['surface-0'];
  const content = colors['content-0'];
  const lowContrastTheme = Math.abs(content.l - surface.l) < 0.2;
  if (lowContrastTheme) {
    applyTheme(DEFAULT_DARK_THEME);
    toast.alert(
      'Tried to load a theme with low contrast, applying a readable theme.'
    );
  }
}
