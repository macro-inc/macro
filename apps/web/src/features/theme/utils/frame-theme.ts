/**
 * Macro's theme for sandboxed frames (HTML previews and canvas artifacts):
 * the app's semantic tokens under their own names, resolved on the host, so a
 * page can match the app and follow the viewer's theme. These names are a
 * contract with stored pages; add to the list, don't rename.
 */
export const FRAME_THEME_TOKENS = [
  '--color-surface',
  '--color-page',
  '--color-panel',
  '--color-dialog',
  '--color-ink',
  '--color-ink-muted',
  '--color-ink-subtle',
  '--color-ink-placeholder',
  '--color-ink-disabled',
  '--color-edge',
  '--color-edge-muted',
  '--color-edge-frame',
  '--color-edge-button',
  '--color-control',
  '--color-accent',
  '--color-accent-contrast',
  '--color-hover',
  '--color-active',
  '--color-selected',
  '--color-link',
  '--color-success',
  '--color-warning',
  '--color-failure',
  '--color-red',
  '--color-orange',
  '--color-amber',
  '--color-yellow',
  '--color-lime',
  '--color-green',
  '--color-teal',
  '--color-cyan',
  '--color-blue',
  '--color-violet',
  '--color-purple',
  '--color-pink',
  '--color-task-status-not-started',
  '--color-task-status-in-progress',
  '--color-task-status-in-review',
  '--color-task-status-completed',
  '--color-task-status-canceled',
  '--font-sans',
  '--font-mono',
] as const;

/** A value that could end the rule or the `<style>` it is written into. */
const UNSAFE_VALUE = /[<>{};]/;

/**
 * The resolved value of each frame token at `element`. Read at the frame
 * itself, `--color-surface` is the surface of the layer the frame sits in.
 */
export function frameThemeTokens(element: Element): Record<string, string> {
  const style = getComputedStyle(element);
  const entries = FRAME_THEME_TOKENS.map(
    (token) => [token, style.getPropertyValue(token).trim()] as const
  );
  return Object.fromEntries(
    entries.filter(([, value]) => value !== '' && !UNSAFE_VALUE.test(value))
  );
}

/** Dark unless the theme marks itself light, as the app's stylesheet does. */
function colorScheme(): 'light' | 'dark' {
  return document.documentElement.dataset.themeLight === 'true'
    ? 'light'
    : 'dark';
}

/** The `:root` rule a frame's theme `<style>` holds, read at `element`. */
export function frameThemeRule(element: Element): string {
  const declarations = Object.entries(frameThemeTokens(element)).map(
    ([token, value]) => `${token}:${value}`
  );
  return `:root{color-scheme:${colorScheme()};${declarations.join(';')}}`;
}

/**
 * Calls `onChange` whenever the app's theme may have changed: the theme
 * writes its tokens to the root's inline style and marks light or dark with
 * `data-theme-light`.
 */
export function watchAppTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style', 'class', 'data-theme-light'],
  });
  return () => observer.disconnect();
}
