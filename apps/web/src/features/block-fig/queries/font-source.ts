/**
 * Fonts for laying out a design's text, from Google Fonts and from this
 * computer.
 *
 * Google: the css2 stylesheet (`fonts.googleapis.com`) and its WOFF2 files
 * (`fonts.gstatic.com`) both answer CORS requests and send
 * `Cross-Origin-Resource-Policy: cross-origin`, so they load under the
 * app's `Cross-Origin-Embedder-Policy: require-corp`; the app sets no
 * `Content-Security-Policy`. Answers are kept in Cache Storage, so a font
 * is fetched once per browser. Local fonts come from the Local Font Access
 * API (Chromium; asks permission once).
 */

import type {
  FigFontSource,
  LocalFontFile,
} from '../context/fig-viewer-context';

const CACHE = 'fig-fonts-v1';

/** A response from Cache Storage, else the network (then cached). */
async function cachedFetch(url: string): Promise<Response> {
  let cache: Cache | undefined;
  try {
    cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) return hit;
  } catch {
    cache = undefined;
  }
  const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  if (cache) {
    try {
      await cache.put(url, response.clone());
    } catch {
      // Storage full or unavailable: the font still loads this time.
    }
  }
  return response;
}

interface FontData {
  family: string;
  style: string;
  fullName: string;
  postscriptName: string;
  blob: () => Promise<Blob>;
}

type LocalFontWindow = Window & {
  queryLocalFonts?: () => Promise<FontData[]>;
};

const toFile = (f: FontData): LocalFontFile => ({
  family: f.family,
  style: f.style,
  fullName: f.fullName,
  postscriptName: f.postscriptName,
  bytes: async () => (await f.blob()).arrayBuffer(),
});

async function queryLocal(): Promise<LocalFontFile[]> {
  const query = (window as LocalFontWindow).queryLocalFonts;
  if (!query) return [];
  return (await query.call(window)).map(toFile);
}

/** Google Fonts and this computer's fonts, as the app loads them. */
export function createFontSource(): FigFontSource {
  const local = typeof window !== 'undefined' && 'queryLocalFonts' in window;
  return {
    stylesheet: async (url) => (await cachedFetch(url)).text(),
    file: async (url) => (await cachedFetch(url)).arrayBuffer(),
    localFonts: local ? queryLocal : undefined,
    grantedLocalFonts: local
      ? async () => {
          try {
            const status = await navigator.permissions.query({
              name: 'local-fonts' as PermissionName,
            });
            return status.state === 'granted' ? await queryLocal() : null;
          } catch {
            return null;
          }
        }
      : undefined,
  };
}
