import { createSignal, onCleanup } from 'solid-js';
import { isServer } from 'solid-js/web';

/** Website-only kill switch. Keep the first-paint copies in index.html and start.html in sync. */
export const WEBSITE_LIGHT_MODE_ENABLED = false;

/** Retain the cream palette for when light mode is re-enabled. */
export type SitePalette = 'cream' | 'dark';

const LIGHT_SCHEME = '(prefers-color-scheme: light)';
const THEME_COLOR: Record<SitePalette, string> = {
  cream: '#f5f1e8',
  dark: '#000000',
};

/** The palette `?theme=` pins, if any. */
export function pinnedPalette(): SitePalette | undefined {
  if (!WEBSITE_LIGHT_MODE_ENABLED) return 'dark';
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
export function applyPalette(
  palette: SitePalette,
  pathname = window.location.pathname
) {
  if (!WEBSITE_LIGHT_MODE_ENABLED) palette = 'dark';
  const root = document.documentElement;
  const homepage = pathname === '/';
  root.style.colorScheme = palette === 'cream' ? 'light' : 'dark';
  root.toggleAttribute('data-homepage', homepage);
  const cream = !homepage && palette === 'cream';
  if (cream) root.dataset.palette = 'cream';
  else delete root.dataset.palette;
  root.dataset.themeLight = palette === 'cream' ? 'true' : 'false';
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute(
      'content',
      homepage
        ? palette === 'cream'
          ? '#ffffff'
          : '#000000'
        : THEME_COLOR[palette]
    );
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
