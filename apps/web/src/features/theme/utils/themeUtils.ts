import { currentThemeId, darkModeTheme, lightModeTheme, setCurrentThemeId, setDarkModeTheme, setHtmlColor, setIsThemeSaved, setLightModeTheme, setThemeDepth, setThemeMode, setUserThemes, systemMode, themeDepth, themeMode, themes, userThemes} from '../signals/themeSignals';
import { semanticTokens, type ThemeV2, type ThemeV2Tokens } from '../types/themeTypes';
import { themeReactive } from '../signals/themeReactive';
import { toast } from '@core/component/Toast/Toast';
import { batch, createEffect, on } from 'solid-js';
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from '../constants';

export function exportTheme(themeId?: string){
  const id = themeId ?? currentThemeId();
  const theme = JSON.stringify(themes().find((t) => t.id === id));
  navigator.clipboard.writeText(theme);
}

async function _importTheme(): Promise<void>{
  try {
    const text = await navigator.clipboard.readText();
    const parsed: unknown = JSON.parse(text);
    if(!isThemeV2(parsed)){
      toast.alert('Clipboard does not contain a valid theme.');
      return;
    }
    const id = crypto.randomUUID();
    const newTheme: ThemeV2 = {
      id,
      name: parsed.name,
      version: parsed.version,
      depth: parsed.depth,
      tokens: parsed.tokens,
    };
    setUserThemes([...userThemes(), newTheme]);
    applyTheme(id);
  } catch(e) {
    console.error('Failed to import theme:', e);
    toast.alert('Failed to import theme from clipboard.');
  }
}

function isThemeV2(value: unknown): value is ThemeV2 {
  if(typeof value !== 'object' || value === null){return false}
  const v = value as Record<string, unknown>;
  if(typeof v.name !== 'string' || typeof v.version !== 'number' || typeof v.depth !== 'number' || typeof v.tokens !== 'object' || v.tokens === null){return false}
  const tokenKeys: Array<keyof ThemeV2Tokens> = ['a0','a1','a2','a3','a4','b0','b1','b2','b3','b4','c0','c1','c2','c3','c4'];
  const tokens = v.tokens as Record<string, unknown>;
  return tokenKeys.every((key) => {
    const t = tokens[key];
    if(typeof t !== 'object' || t === null){return false}
    const tok = t as Record<string, unknown>;
    return typeof tok.l === 'number' && typeof tok.c === 'number' && typeof tok.h === 'number';
  });
}

/** Writes a theme's semantic-token overrides to the document root, clearing
 *  tokens the theme doesn't override. */
function setThemeOverrides(theme: ThemeV2): void{
  for (const token of semanticTokens) {
    const themeOverride = theme.overrides?.find((o) => o.token === token)
    if (themeOverride) {
      document.documentElement.style.setProperty(`--theme-${token}`, `oklch(${themeOverride.value.l} ${themeOverride.value.c} ${themeOverride.value.h})`)
    } else {
      document.documentElement.style.removeProperty(`--theme-${token}`)
    }
  }
}

/** Writes a token set + depth to the live theme signals (the CSS variables). */
function setLiveTokens(tokens: ThemeV2Tokens, depth: number): void{
  batch(() => {
    (Object.keys(tokens) as Array<keyof ThemeV2Tokens>).forEach((tokenKey) => {
      (Object.keys(tokens[tokenKey]) as Array<'l' | 'c' | 'h'>).forEach((prop) => {
          themeReactive[tokenKey][prop][1](tokens[tokenKey][prop]);
        });
      }
    );
    setThemeDepth(depth);
  });
}

/** The live tokens/overrides as they were when a preview started; restored
 *  when the preview ends. Null while no preview is active. */
let previewSnapshot: {
  tokens: ThemeV2Tokens;
  depth: number;
  overrides: Record<string, string>;
} | null = null;

export function applyTheme(id: string): void{
  let theme = themes().find((t) => t.id === id);
  if(!theme){
    console.error(`theme not found: ${id}`);
    theme = themes().find((t) => t.id === DEFAULT_DARK_THEME)!;
  }
  setCurrentThemeId(theme.id);
  // Committing a theme supersedes any in-flight preview; drop the snapshot so
  // clearThemePreview doesn't revert the commit.
  previewSnapshot = null;

  setThemeOverrides(theme);
  setLiveTokens(theme.tokens, theme.depth ?? 0.15);
  queueMicrotask(() => {/* scuffed af */
    setIsThemeSaved(true);
    syncHtmlColor();
  });
}

/** Temporarily shows a theme (e.g. while it's hovered/highlighted in a picker)
 *  without selecting it: only the live token signals and override CSS vars
 *  change — currentThemeId, saved-state, and the persisted first-paint color
 *  are untouched. Revert with clearThemePreview; committing via applyTheme
 *  makes the preview permanent. */
export function previewTheme(id: string): void{
  const theme = themes().find((t) => t.id === id);
  if(!theme){return}
  if(!previewSnapshot){
    const overrides: Record<string, string> = {};
    for(const token of semanticTokens){
      overrides[token] = document.documentElement.style.getPropertyValue(`--theme-${token}`);
    }
    // Snapshot the live tokens (not the selected theme id) so ending the
    // preview restores unsaved in-editor edits too.
    previewSnapshot = { tokens: getCurrentTokens(), depth: themeDepth(), overrides };
  }
  setThemeOverrides(theme);
  setLiveTokens(theme.tokens, theme.depth ?? 0.15);
}

/** Ends an active theme preview, restoring the pre-preview tokens. No-op when
 *  nothing is being previewed. */
export function clearThemePreview(): void{
  if(!previewSnapshot){return}
  for(const token of semanticTokens){
    const value = previewSnapshot.overrides[token];
    if(value){
      document.documentElement.style.setProperty(`--theme-${token}`, value);
    } else {
      document.documentElement.style.removeProperty(`--theme-${token}`);
    }
  }
  setLiveTokens(previewSnapshot.tokens, previewSnapshot.depth);
  previewSnapshot = null;
}

/** Resolves the theme id that should be live for the current "Active theme"
 *  mode: the pinned light/dark theme, or — in system mode — whichever matches
 *  the OS color scheme. Read inside a reactive scope, it subscribes to the mode,
 *  the OS scheme (system mode only), and the relevant per-mode theme. */
export function resolveActiveThemeId(): string{
  const resolved = themeMode() === 'system' ? systemMode() : themeMode();
  return resolved === 'dark' ? darkModeTheme() : lightModeTheme();
}

/** Keeps the active theme in sync with the "Active theme" mode: applies the
 *  pinned light/dark theme, or follows the OS color scheme in system mode.
 *  Re-applies whenever the mode, the OS scheme, or the *active* mode's theme
 *  changes — but not when the inactive mode's theme changes (that id isn't read
 *  by resolveActiveThemeId, so it isn't tracked). Call once from a reactive root
 *  (see Root.tsx). */
export function systemThemeEffect(): void{
  createEffect(
    on(
      resolveActiveThemeId,
      (id) => applyTheme(id),
      { defer: true }
    )
  );
}

/** Persists the live background color, used for the pre-hydration first paint. */
function syncHtmlColor(): void{
  setHtmlColor({color: `oklch(${themeReactive.b0.l[0]()} ${themeReactive.b0.c[0]()} ${themeReactive.b0.h[0]()}deg)`});
}

/** Flips the lightness of every background (b*) and text (c*) token, leaving
 *  chroma and hue untouched. The shared primitive behind light/dark mode. */
function invertLightness(): void{
  batch(() => {
    themeReactive.b0.l[1](1 - themeReactive.b0.l[0]());
    themeReactive.b1.l[1](1 - themeReactive.b1.l[0]());
    themeReactive.b2.l[1](1 - themeReactive.b2.l[0]());
    themeReactive.b3.l[1](1 - themeReactive.b3.l[0]());
    themeReactive.b4.l[1](1 - themeReactive.b4.l[0]());
    themeReactive.c0.l[1](1 - themeReactive.c0.l[0]());
    themeReactive.c1.l[1](1 - themeReactive.c1.l[0]());
    themeReactive.c2.l[1](1 - themeReactive.c2.l[0]());
    themeReactive.c3.l[1](1 - themeReactive.c3.l[0]());
    themeReactive.c4.l[1](1 - themeReactive.c4.l[0]());
  });
}

/** Flips the theme between light and dark by inverting the background/text lightness
 *  — the same axis as the contrast slider's sign. Treated as an edit: marks the theme
 *  unsaved, unless the flip lands back on the stored theme (then it's saved again). */
export function flipLightDark(): void{
  invertLightness();
  queueMicrotask(() => {
    setIsThemeSaved(liveMatchesStoredTheme());
    syncHtmlColor();
  });
}

/** True when the live theme equals the currently-selected stored theme, within a
 *  float tolerance (1 − (1 − l) from a double flip isn't bit-exact). */
function liveMatchesStoredTheme(): boolean{
  const stored = themes().find((t) => t.id === currentThemeId());
  if(!stored){return false}
  const live = getCurrentTokens();
  const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  const tokensMatch = (Object.keys(stored.tokens) as Array<keyof ThemeV2Tokens>).every((k) =>
    close(live[k].l, stored.tokens[k].l) &&
    close(live[k].c, stored.tokens[k].c) &&
    close(live[k].h, stored.tokens[k].h)
  );
  return tokensMatch && close(themeDepth(), stored.depth ?? 0.15);
}

function getCurrentTokens(): ThemeV2Tokens{
  const themeTokens: ThemeV2Tokens = {
    a0: { l: themeReactive.a0.l[0](), c: themeReactive.a0.c[0](), h: themeReactive.a0.h[0]()},
    a1: { l: themeReactive.a1.l[0](), c: themeReactive.a1.c[0](), h: themeReactive.a1.h[0]()},
    a2: { l: themeReactive.a2.l[0](), c: themeReactive.a2.c[0](), h: themeReactive.a2.h[0]()},
    a3: { l: themeReactive.a3.l[0](), c: themeReactive.a3.c[0](), h: themeReactive.a3.h[0]()},
    a4: { l: themeReactive.a4.l[0](), c: themeReactive.a4.c[0](), h: themeReactive.a4.h[0]()},
    b0: { l: themeReactive.b0.l[0](), c: themeReactive.b0.c[0](), h: themeReactive.b0.h[0]()},
    b1: { l: themeReactive.b1.l[0](), c: themeReactive.b1.c[0](), h: themeReactive.b1.h[0]()},
    b2: { l: themeReactive.b2.l[0](), c: themeReactive.b2.c[0](), h: themeReactive.b2.h[0]()},
    b3: { l: themeReactive.b3.l[0](), c: themeReactive.b3.c[0](), h: themeReactive.b3.h[0]()},
    b4: { l: themeReactive.b4.l[0](), c: themeReactive.b4.c[0](), h: themeReactive.b4.h[0]()},
    c0: { l: themeReactive.c0.l[0](), c: themeReactive.c0.c[0](), h: themeReactive.c0.h[0]()},
    c1: { l: themeReactive.c1.l[0](), c: themeReactive.c1.c[0](), h: themeReactive.c1.h[0]()},
    c2: { l: themeReactive.c2.l[0](), c: themeReactive.c2.c[0](), h: themeReactive.c2.h[0]()},
    c3: { l: themeReactive.c3.l[0](), c: themeReactive.c3.c[0](), h: themeReactive.c3.h[0]()},
    c4: { l: themeReactive.c4.l[0](), c: themeReactive.c4.c[0](), h: themeReactive.c4.h[0]()},
  };
  return themeTokens;
}

export function saveTheme(name: string): void{
  const id = crypto.randomUUID();
  const tokens = getCurrentTokens();
  const newTheme: ThemeV2 = {
    id: id,
    name: name,
    version: 2,
    depth: themeDepth(),
    tokens: tokens,
  };
  setUserThemes([...userThemes(), newTheme]);
  setCurrentThemeId(id);
  setIsThemeSaved(true);
}

/** Save the live theme back onto an existing custom theme (same id), updating
 *  its name, depth, and tokens in place. */
export function updateTheme(id: string, name: string): void{
  const tokens = getCurrentTokens();
  setUserThemes(
    userThemes().map((theme) =>
      theme.id === id
        ? { ...theme, name, depth: themeDepth(), tokens }
        : theme
    )
  );
  setCurrentThemeId(id);
  setIsThemeSaved(true);
}

export function deleteTheme(id: string): void{
  setUserThemes(userThemes().filter((theme) => theme.id !== id));
  // A deleted theme can no longer serve as a per-mode default; fall back to the
  // built-in Macro light/dark themes.
  if(lightModeTheme() === id){setLightModeTheme(DEFAULT_LIGHT_THEME)}
  if(darkModeTheme() === id){setDarkModeTheme(DEFAULT_DARK_THEME)}
  if(currentThemeId() === id){
    // Keep the live tokens in place so the picker still shows this theme's
    // swatch, but mark it unsaved/unselected — it now reads as "Unsaved Theme"
    // until the user saves it again.
    setIsThemeSaved(false);
    setCurrentThemeId('');
  }
}

/** A synthetic ThemeV2 snapshot of the live (in-editor) tokens. Lets the picker
 *  render a swatch for the active theme even when it isn't a stored theme — e.g.
 *  after the selected theme was deleted, leaving an unsaved live theme. Reading
 *  it inside a reactive scope subscribes to the live token signals. */
export function getLiveTheme(): ThemeV2{
  return {
    id: '',
    name: 'Unsaved Theme',
    version: 2,
    depth: themeDepth(),
    tokens: getCurrentTokens(),
  };
}

/** Intrinsic darkness of a stored theme: dark when text is lighter than background. */
export function isTokensDark(tokens: ThemeV2Tokens): boolean {
  return tokens.c0.l > tokens.b0.l;
}

/** Pins a theme as the "Active theme": makes it the stored theme for its
 *  intrinsic light/dark mode and switches the mode to match, so
 *  resolveActiveThemeId / systemThemeEffect apply it live. Shared by the settings
 *  Active-theme picker and the command-palette "Change theme" action so choosing
 *  a theme in either place is reflected in the other. */
export function pinTheme(theme: ThemeV2): void {
  if (isTokensDark(theme.tokens)) {
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
  const spec = themes().find((t) => t.id === currentThemeId())?.tokens;
  if(!spec){return}// Check if the contrast is too low, so that users can't get stuck with an unreadable theme
  const lowContrastTheme = Math.abs(spec.c0.l - spec.b0.l) < 0.2;
  if(lowContrastTheme){
    applyTheme(DEFAULT_DARK_THEME);
    toast.alert('Tried to load a theme with low contrast, applying a readable theme.');
  }
}
