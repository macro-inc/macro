import shortuuid from 'short-uuid';
import { maybeOpenInApp } from './macroAppUrl';
import { getWebOrigin } from './webOrigin';

const short = shortuuid(shortuuid.constants.flickrBase58, {
  consistentLength: false,
});

function unwrapShortId(id: string): string {
  // Check if a string is valid (length and alphabet) *AND* translates to a valid UUID
  if (short.validate(id, true)) {
    return short.toUUID(id);
  }
  return id;
}

/**
 * The single entry point for opening a URL from user content or UI actions —
 * use this instead of `window.open`.
 * If Macro urls end up being called here (e.g. a bare markdown url) we open the link in-app when
 * running inside the native Tauri shell (where `window.open` would kick the
 * user out to the system browser); everything else opens a new tab on web or
 * the system browser.
 */
export function openExternalUrl(url: string) {
  if (maybeOpenInApp(url)) return;
  window.open(url, '_blank', 'noopener,noreferrer')?.focus();
}

export function transformShortIdInUrlPathname(pathname: string) {
  const parts = pathname.split('/');
  const newParts = [];
  for (const part of parts) {
    newParts.push(unwrapShortId(part));
  }
  const newPathname = newParts.join('/');
  return newPathname;
}

export function buildSimpleEntityUrl(
  entity: { type: string; id: string },
  params?: Record<string, string>
): string {
  const urlString = `${getWebOrigin()}/app/${entity.type}/${entity.id}`;
  const url = new URL(urlString);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}
