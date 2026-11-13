import { invoke } from '@tauri-apps/api/core';
import { type as osType } from '@tauri-apps/plugin-os';
import shortuuid from 'short-uuid';
import { fireAndForget } from './fireAndForget';
import { getNativeMobilePlatform, isTauri } from './platform';
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

  if (getNativeMobilePlatform()) {
    // Mobile webviews have no new-window hook, so a same-window navigation
    // reaches the native navigation plugin, which cancels it and opens the URL
    // in the system browser.
    window.open(url, '_self')?.focus();
    return;
  }

  if (isTauri()) {
    fireAndForget(openFromDesktop(url), 'open-external-url');
    return;
  }

  window.open(url, '_blank', 'noopener,noreferrer')?.focus();
}

/**
 * Desktop hands the URL to the native navigation policy, which opens the system
 * browser or routes an app link in-app. Never navigate the app's own page: that
 * runs its beforeunload handlers (ending a call, or raising a leave-page prompt
 * that blocks the window) before the native side cancels the navigation. A
 * popup request is no substitute: WebKitGTK drops one once the click's user
 * gesture has expired, as it has after an awaited OAuth start.
 */
async function openFromDesktop(url: string) {
  let opened: boolean;
  try {
    opened = await invoke<boolean>('open_external_url', { url });
  } catch {
    // A native shell older than the command. Chromium (macOS) sends a popup
    // request to the new-window hook without a gesture; elsewhere keep the
    // navigation the hook has always cancelled.
    window.open(url, osType() === 'macos' ? '_blank' : '_self');
    return;
  }
  // A standalone document on the app's origin needs a popup webview.
  if (!opened) window.open(url, '_blank', 'noopener,noreferrer');
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

/** Canonical route segments that differ from the entity type. Email threads
 * open in Mail; /app/email is the legacy block URL. */
const ROUTE_SEGMENTS = new Map([
  ['routine', 'routines'],
  ['email', 'mail'],
]);

export function buildSimpleEntityUrl(
  entity: { type: string; id: string },
  params?: Record<string, string>
): string {
  const type = ROUTE_SEGMENTS.get(entity.type) ?? entity.type;
  const urlString = `${getWebOrigin()}/app/${type}/${entity.id}`;
  const url = new URL(urlString);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}
