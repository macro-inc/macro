import { isTauri } from '@core/util/platform';
import { openExternalUrl } from '@core/util/url';

/** Open a blank tab during the click so later OAuth assign is not blocked. */
export function reserveOauthPopup(): Window | null {
  if (isTauri()) return null;
  const popup = window.open('about:blank', '_blank');
  if (popup) popup.opener = null;
  return popup;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Whether `url` is a sign-in page this app may open: https, or http on a
 * loopback host for a local server. A remote server picks this URL, and the
 * reserved tab has this app's origin, so a `javascript:` or `data:` URL would
 * run as Macro.
 */
export function isSafeOauthUrl(url: string): boolean {
  if (!URL.canParse(url)) return false;
  const parsed = new URL(url);
  return (
    parsed.protocol === 'https:' ||
    (parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname))
  );
}

/**
 * Open `url` in the reserved tab, or the system browser without one. A URL
 * that is not a safe sign-in page is refused and the tab closed; returns
 * whether it opened.
 */
export function assignOauthUrl(popup: Window | null, url: string): boolean {
  if (!isSafeOauthUrl(url)) {
    popup?.close();
    return false;
  }
  if (popup && !popup.closed) {
    popup.location.href = url;
    return true;
  }
  openExternalUrl(url);
  return true;
}
