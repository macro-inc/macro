import shortuuid from 'short-uuid';
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

/** Handles a URL before the default in-app / new-tab behavior. Returns true
 * when it took ownership of the URL (so no further handling runs). */
type ExternalUrlInterceptor = (url: string) => boolean;

// Insertion-ordered; a Set dedupes a handler registered more than once (e.g.
// if the registering component remounts).
const externalUrlInterceptors = new Set<ExternalUrlInterceptor>();

/**
 * Registers a handler consulted by {@link openExternalUrl} before its default handling.
 * Interceptors are tried in registration order and the first to return true takes ownership of the URL.
 *
 * Returns a function that unregisters the interceptor.
 */
export function registerExternalUrlInterceptor(
  interceptor: ExternalUrlInterceptor
): () => void {
  externalUrlInterceptors.add(interceptor);
  return () => {
    externalUrlInterceptors.delete(interceptor);
  };
}

/**
 * The single entry point for opening a URL from user content or UI actions —
 * use this instead of `window.open`. Registered interceptors are tried first,
 * in registration order, and the first to claim the URL wins; anything left
 * over opens a new tab on web / the system browser.
 */
export function openExternalUrl(url: string) {
  for (const interceptor of externalUrlInterceptors) {
    if (interceptor(url)) return;
  }
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
