import { isTauri } from './platform';
import { getWebOrigin } from './webOrigin';

/**
 * The URL to load an imported file that the build writes to `web-hosted/`
 * (videos; see `assetFileNames` in `vite.base.ts`). Native bundles leave that
 * directory out, so a native build loads the copy the web deploy published;
 * file names carry a content hash, so it is the same file. The dev server
 * serves these files itself.
 */
export function webHostedUrl(url: string): string {
  if (import.meta.env.DEV || !isTauri()) return url;
  return new URL(url, getWebOrigin()).href;
}
