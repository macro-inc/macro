import { isTauri } from '@core/util/platform';

export const ROUTER_BASE = isTauri() ? '/' : '/app';

export const ROUTER_BASE_CONCAT = isTauri() ? '/' : '/app/';

/**
 * Strip the router base from a `location.pathname` (which includes it, e.g.
 * `/app/component/inbox`) so it can be compared to — and reused with — the
 * base-relative paths that `navigate()` and route definitions use.
 */
export const toBaseRelative = (pathname: string): string => {
  if (ROUTER_BASE === '/') return pathname;
  if (pathname === ROUTER_BASE) return '/';
  if (pathname.startsWith(`${ROUTER_BASE}/`)) {
    return pathname.slice(ROUTER_BASE.length);
  }
  return pathname;
};
