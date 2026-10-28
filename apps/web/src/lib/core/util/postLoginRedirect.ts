import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';

const POST_LOGIN_REDIRECT_KEY = 'redirectUrl';
const NATIVE_REDIRECT_KEY = 'nativePostLoginRedirect';
const NATIVE_REDIRECT_TTL = 30 * 60 * 1000;

function nativeRelativePath(value: string): string | null {
  const current = new URL(window.location.href);
  const parsed = new URL(value, current);
  if (parsed.protocol !== current.protocol || parsed.host !== current.host)
    return null;
  // Native uses a hash router; full location URLs must restore the route inside
  // the hash, not navigate to a second nested hash-router root.
  if (parsed.hash.startsWith('#/')) {
    const route = parsed.hash.slice(1);
    const destination = new URL(route, current);
    if (
      destination.protocol !== current.protocol ||
      destination.host !== current.host
    )
      return null;
    return route;
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/** Preserves a URL for BasePathComponent to restore after authentication. */
export function setPostLoginRedirect(url: string): void {
  if (isNativeMobilePlatform()) {
    const path = nativeRelativePath(url);
    if (!path) return;
    localStorage.setItem(
      NATIVE_REDIRECT_KEY,
      JSON.stringify({
        path,
        expiresAt: Date.now() + NATIVE_REDIRECT_TTL,
      })
    );
    return;
  }
  sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, url);
}

/** Explicit logout must not carry a previous account's pending destination. */
export function clearPostLoginRedirect(): void {
  localStorage.removeItem(NATIVE_REDIRECT_KEY);
  sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY);
}

/** Reads and clears the URL preserved by {@link setPostLoginRedirect}. */
export function consumePostLoginRedirect(): string | null {
  if (isNativeMobilePlatform()) {
    const stored = localStorage.getItem(NATIVE_REDIRECT_KEY);
    localStorage.removeItem(NATIVE_REDIRECT_KEY);
    if (!stored) return null;
    try {
      const value = JSON.parse(stored);
      if (
        typeof value.path !== 'string' ||
        typeof value.expiresAt !== 'number' ||
        value.expiresAt <= Date.now()
      )
        return null;
      return nativeRelativePath(value.path);
    } catch {
      return null;
    }
  }
  const url = sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY);
  if (url !== null) {
    sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY);
  }
  return url;
}
