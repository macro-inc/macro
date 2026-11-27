import { createSignal } from 'solid-js';
import { isServer } from 'solid-js/web';

/** The website's two palettes: dark, and the cream light theme. */
export type SitePalette = 'cream' | 'dark';

/**
 * Where the visitor's choice is kept. The first-paint scripts in index.html
 * and start.html read the same key, so keep the three in sync.
 */
export const SITE_PALETTE_STORAGE_KEY = 'macro-site-palette';

const THEME_COLOR: Record<SitePalette, string> = {
  cream: '#f3efe8',
  dark: '#000000',
};

function isSitePalette(value: string | null): value is SitePalette {
  return value === 'cream' || value === 'dark';
}

/** The palette `?theme=` pins, if any. It wins over the stored choice. */
export function pinnedPalette(): SitePalette | undefined {
  if (isServer) return undefined;
  const theme = new URLSearchParams(window.location.search).get('theme');
  return isSitePalette(theme) ? theme : undefined;
}

/** The palette the visitor picked with the theme toggle, if any. */
function storedPalette(): SitePalette | undefined {
  try {
    const stored = window.localStorage.getItem(SITE_PALETTE_STORAGE_KEY);
    return isSitePalette(stored) ? stored : undefined;
  } catch {
    // Storage can be blocked; the site then stays on its default.
    return undefined;
  }
}

/**
 * Dark unless the visitor chose otherwise. The OS color scheme is deliberately
 * not consulted; to follow it, fall back to a `prefers-color-scheme` check here
 * and in the first-paint scripts instead of to 'dark'.
 */
export function preferredPalette(): SitePalette {
  if (isServer) return 'dark';
  return pinnedPalette() ?? storedPalette() ?? 'dark';
}

const [sitePalette, setSitePalette] = createSignal(preferredPalette());

/** The palette in use, for the few components that cannot switch in CSS. */
export { sitePalette };

/** Marks <html> with the palette; every light style keys off these attributes. */
export function applyPalette(
  palette: SitePalette,
  pathname = window.location.pathname
) {
  const root = document.documentElement;
  const light = palette === 'cream';
  root.style.colorScheme = light ? 'light' : 'dark';
  root.toggleAttribute('data-homepage', pathname === '/');
  if (light) root.dataset.palette = 'cream';
  else delete root.dataset.palette;
  root.dataset.themeLight = String(light);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLOR[palette]);
  setSitePalette(palette);
}

/** Switches the palette from the theme toggle and remembers the choice. */
export function choosePalette(palette: SitePalette) {
  try {
    window.localStorage.setItem(SITE_PALETTE_STORAGE_KEY, palette);
  } catch {
    // Storage can be blocked; the choice then lasts until the page reloads.
  }

  // A `?theme=` pin would otherwise override the choice on the next navigation.
  const url = new URL(window.location.href);
  if (url.searchParams.has('theme')) {
    url.searchParams.delete('theme');
    window.history.replaceState(window.history.state, '', url);
  }

  applyPalette(palette);
}
