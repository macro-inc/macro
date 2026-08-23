import { toast } from '@core/component/Toast/Toast';
import { batch, createEffect, createMemo, on } from 'solid-js';
import {
  type AppearancePreference,
  paintChrome,
  type ResolvedTheme,
  resolveAppearance,
} from '../appearance';
import {
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  DEFAULT_THEME_ID,
} from '../constants';
import { themeReactive } from '../signals/themeReactive';
import {
  currentThemeId,
  darkModeTheme,
  lightModeTheme,
  liveThemeMode,
  setCurrentThemeId,
  setDarkModeTheme,
  setIsThemeSaved,
  setLightModeTheme,
  setLiveThemeMode,
  setSurfaceCache,
  setThemeColorTokens,
  setThemeMode,
  setUserThemes,
  surfaceCache,
  systemMode,
  themeColorTokens,
  themeMode,
  themes,
  userThemes,
} from '../signals/themeSignals';
import type {
  ThemeColorTokens,
  ThemeV2Tokens,
  ThemeV3,
} from '../types/themeTypes';
import { getOklch } from './colorUtil';
import { convertThemev2v3 } from './themeMigrations';
import { isThemeV2, isThemeV3 } from './themeValidation';
import { normalizeThemeColorTokens } from './themeVNext';

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

/** Old non-CSS integrations still consume a/b/c numeric signals. V3 does not
 * store those values; this bridge derives them from the rendered token graph. */
const LEGACY_TOKEN_MAP = {
  a0: 'accent',
  a1: 'orange',
  a2: 'lime',
  a3: 'teal',
  a4: 'blue',
  b0: 'surface-0',
  b1: 'surface-1',
  b2: 'surface-2',
  b3: 'edge-muted',
  b4: 'edge',
  c0: 'content-0',
  c1: 'content-1',
  c2: 'content-2',
  c3: 'content-3',
  c4: 'content-4',
} as const satisfies Record<keyof ThemeV2Tokens, string>;

function resolvedTokenOklch(
  token: string
): { l: number; c: number; h: number } | null {
  const authored = themeColorTokens()[token];
  if (authored) {
    try {
      return getOklch(authored);
    } catch {
      // var() and color-mix() values need the browser to resolve the graph.
    }
  }
  if (typeof document === 'undefined') return null;

  const probe = document.createElement('span');
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none';
  probe.style.color = `var(--color-${token})`;
  document.documentElement.append(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();

  try {
    return getOklch(resolved);
  } catch {
    return null;
  }
}

function syncLegacyCompatibilityTokens(): void {
  batch(() => {
    for (const [legacyToken, colorToken] of Object.entries(LEGACY_TOKEN_MAP)) {
      const color = resolvedTokenOklch(colorToken);
      if (!color) continue;
      const target = themeReactive[legacyToken as keyof ThemeV2Tokens];
      target.l[1](color.l);
      target.c[1](color.c);
      target.h[1](color.h);
    }
  });
}

const LAYER_RELATIVE_TOKENS = {
  surface: 'var(--layer-surface)',
  inset: 'var(--layer-inset)',
  lift: 'var(--layer-lift)',
} as const;

function renderThemeColorToken(token: string, value: string): void {
  if (token === 'panel') {
    // Keep the authored structural value separate from the public semantic var
    // so containers can scope --color-panel without losing the theme source.
    document.documentElement.style.removeProperty('--color-panel');
    document.documentElement.style.setProperty('--theme-panel', value);
    return;
  }

  const layerDefault =
    LAYER_RELATIVE_TOKENS[token as keyof typeof LAYER_RELATIVE_TOKENS];

  if (layerDefault) {
    // CSS owns the public --color-* mapping for layer-relative semantics.
    // Only author an optional theme override when the assignment is custom.
    document.documentElement.style.removeProperty(`--color-${token}`);
    if (value === layerDefault) {
      document.documentElement.style.removeProperty(`--theme-${token}`);
    } else {
      document.documentElement.style.setProperty(`--theme-${token}`, value);
    }
    return;
  }

  document.documentElement.style.setProperty(`--color-${token}`, value);
}

/** Applies a color token for an editor drag without updating persisted state. */
export function previewLiveThemeColorToken(token: string, value: string): void {
  renderThemeColorToken(token, value);
}

/** Writes all VNext authored tokens to the root and updates editor state. */
export function setLiveThemeColorTokens(tokens: ThemeColorTokens): void {
  const normalizedTokens = normalizeThemeColorTokens(tokens, liveThemeMode());
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
  setThemeColorTokens(normalizedTokens);
  syncLegacyCompatibilityTokens();
  paintLiveChrome();
}

/** Updates one authored token immediately; persistence still happens on save. */
export function updateLiveThemeColorToken(token: string, value: string): void {
  const next = { ...themeColorTokens(), [token]: value };
  renderThemeColorToken(token, value);
  renderedColorTokenKeys.add(token);
  setThemeColorTokens(next);
  syncLegacyCompatibilityTokens();
  paintLiveChrome();
  setIsThemeSaved(false);
}

/** The live tokens/overrides as they were when a preview started; restored
 *  when the preview ends. Null while no preview is active. */
let previewSnapshot: {
  colorTokens: ThemeColorTokens;
  mode: 'light' | 'dark';
} | null = null;

export function applyTheme(id: string): void {
  let theme = themes().find((t) => t.id === id);
  if (!theme) {
    console.error(`theme not found: ${id}`);
    theme = themes().find((t) => t.id === DEFAULT_THEME_ID[liveThemeMode()])!;
  }
  setCurrentThemeId(theme.id);
  // Drop the snapshot so a later clearThemePreview cannot restore the
  // pre-commit tokens over the theme we just applied.
  previewSnapshot = null;

  setLiveThemeMode(theme.mode);
  setLiveThemeColorTokens(theme.colorTokens);
  queueMicrotask(() => {
    setIsThemeSaved(true);
    refreshSurfaceCache();
  });
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
  if (!previewSnapshot) {
    // Snapshot the live tokens (not the selected theme id) so ending the
    // preview restores unsaved in-editor edits too.
    previewSnapshot = {
      colorTokens: { ...themeColorTokens() },
      mode: liveThemeMode(),
    };
  }
  setLiveThemeMode(theme.mode);
  setLiveThemeColorTokens(theme.colorTokens);
}

/** Ends an active theme preview, restoring the pre-preview tokens. No-op when
 *  nothing is being previewed. */
export function clearThemePreview(): void {
  if (!previewSnapshot) {
    return;
  }
  setLiveThemeMode(previewSnapshot.mode);
  setLiveThemeColorTokens(previewSnapshot.colorTokens);
  previewSnapshot = null;
}

function livePreference(): AppearancePreference {
  return {
    mode: themeMode(),
    themeId: {
      light: lightModeTheme(),
      dark: darkModeTheme(),
    },
  };
}

export function activeAppearance(): ResolvedTheme {
  return resolveAppearance(livePreference(), systemMode());
}

export function systemAppearance(): ResolvedTheme {
  return resolveAppearance(
    { ...livePreference(), mode: 'system' },
    systemMode()
  );
}

export function resolveActiveThemeId(): string {
  return activeAppearance().themeId;
}

export function applyResolvedAppearance(): void {
  applyTheme(activeAppearance().themeId);
}

export function systemThemeEffect(): void {
  // Memo the resolved id so a write to the inactive scheme's stored id does
  // not re-apply. The effect is deferred. First apply is module init plus
  // Root onMount.
  const themeId = createMemo(() => activeAppearance().themeId);
  createEffect(on(themeId, (id) => applyTheme(id), { defer: true }));
}

function formatOklch(color: { l: number; c: number; h: number }): string {
  return `oklch(${color.l} ${color.c} ${color.h}deg)`;
}

function paintLiveChrome(): void {
  const color = resolvedTokenOklch('surface-0');
  if (!color) return;
  paintChrome({
    scheme: liveThemeMode(),
    surface: formatOklch(color),
  });
}

function refreshSurfaceCache(): void {
  const color = resolvedTokenOklch('surface-0');
  if (!color) return;
  setSurfaceCache({
    ...surfaceCache(),
    [liveThemeMode()]: formatOklch(color),
  });
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

export function pinTheme(theme: ThemeV3): void {
  if (theme.mode === 'dark') {
    setDarkModeTheme(theme.id);
    setThemeMode('dark');
  } else {
    setLightModeTheme(theme.id);
    setThemeMode('light');
  }
}

export function applySystemTheme(): void {
  setThemeMode('system');
  applyResolvedAppearance();
}

export function ensureMinimalThemeContrast() {
  const surface = resolvedTokenOklch('surface-0');
  const content = resolvedTokenOklch('content-0');
  if (!surface || !content) {
    return;
  }
  const lowContrastTheme = Math.abs(content.l - surface.l) < 0.2;
  if (lowContrastTheme) {
    applyTheme(DEFAULT_DARK_THEME);
    toast.alert(
      'Tried to load a theme with low contrast, applying a readable theme.'
    );
  }
}
