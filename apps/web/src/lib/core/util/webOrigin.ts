import { isTauri } from './platform';

/** The path the web app is served under; the native shells use `/`. */
const WEB_ROUTER_BASE = '/app';

export function getWebOrigin(): string {
  if (isTauri()) {
    return import.meta.env.MODE === 'development'
      ? 'https://dev.macro.com'
      : 'https://macro.com';
  }
  return window.location.origin;
}

/**
 * The web URL of the view the user is on, for links that leave the app
 * (clipboard, email bodies, calendar descriptions).
 *
 * The native shells serve the app from their own origin
 * (`http://tauri.localhost`, `tauri://localhost`) and keep the route in the
 * hash, so a copied `window.location.href` from there names a host only that
 * app can reach and a path the web app does not route.
 */
export function getCurrentWebUrl(): string {
  if (!isTauri()) return window.location.href;

  // The hash carries the route with its own query, e.g. `#/agent/a/~/md/b?x=1`.
  const route = window.location.hash.replace(/^#/, '');
  const path = route.startsWith('/') ? route : `/${route}`;

  return `${getWebOrigin()}${WEB_ROUTER_BASE}${path === '/' ? '' : path}`;
}
