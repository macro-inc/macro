import { ROUTER_BASE } from '@app/constants/routerBase';

export const SETTINGS_PATH = '/settings';

/**
 * Strip the router base from a `location.pathname` (which includes it, e.g.
 * `/app/settings`) so it can be compared to — and reused with — the
 * base-relative paths that `navigate()` and route definitions use.
 */
export const toBaseRelative = (pathname: string) => {
  if (ROUTER_BASE === '/') return pathname;
  if (pathname === ROUTER_BASE) return '/';
  if (pathname.startsWith(`${ROUTER_BASE}/`)) {
    return pathname.slice(ROUTER_BASE.length);
  }
  return pathname;
};

/** Whether a `location.pathname` (base included) is the settings route. */
export const isSettingsPath = (pathname: string) => {
  const path = toBaseRelative(pathname);
  return path === SETTINGS_PATH || path.startsWith(`${SETTINGS_PATH}/`);
};
