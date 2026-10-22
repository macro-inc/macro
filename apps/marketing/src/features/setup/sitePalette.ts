import { createSignal, onCleanup } from 'solid-js';
import { isServer } from 'solid-js/web';

/**
 * Product pages and `/start` render in the cream palette
 * (cream-preview.css) when the visitor's OS or browser prefers a light color
 * scheme, and in the dark palette otherwise. `?theme=cream` or `?theme=dark`
 * pins either one. The homepage uses a white shell with dark product previews in either system theme.
 *
 * start.html and index.html apply the same choice in an inline <head> script
 * so prerendered pages paint in the right palette; keep them in sync.
 */
export type SitePalette = 'cream' | 'dark';

const LIGHT_SCHEME = '(prefers-color-scheme: light)';
const THEME_COLOR: Record<SitePalette, string> = {
  cream: '#f5f1e8',
  dark: '#000000',
};

/** The palette `?theme=` pins, if any. */
export function pinnedPalette(): SitePalette | undefined {
  if (isServer) return undefined;
  const theme = new URLSearchParams(window.location.search).get('theme');
  return theme === 'cream' || theme === 'dark' ? theme : undefined;
}

export function preferredPalette(): SitePalette {
  if (isServer) return 'dark';
  return (
    pinnedPalette() ??
    (window.matchMedia?.(LIGHT_SCHEME).matches ? 'cream' : 'dark')
  );
}

/** Marks <html> with the palette; light glass is keyed off `data-theme-light`. */
export function applyPalette(palette: SitePalette) {
  const root = document.documentElement;
  const homepage = window.location.pathname === '/';
  root.toggleAttribute('data-homepage', homepage);
  const cream = !homepage && palette === 'cream';
  if (cream) root.dataset.palette = 'cream';
  else delete root.dataset.palette;
  root.dataset.themeLight = cream ? 'true' : 'false';
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', homepage ? '#ffffff' : THEME_COLOR[palette]);
}

/** Calls `listener` with the preferred palette whenever the OS scheme changes. */
export function onPaletteChange(listener: (palette: SitePalette) => void) {
  const query = window.matchMedia?.(LIGHT_SCHEME);
  const handle = () => listener(preferredPalette());
  query?.addEventListener('change', handle);
  return () => query?.removeEventListener('change', handle);
}

/** The preferred palette as a signal, following OS scheme changes. */
export function createSitePalette() {
  const [palette, setPalette] = createSignal(preferredPalette());
  if (!isServer) onCleanup(onPaletteChange(setPalette));
  return palette;
}
