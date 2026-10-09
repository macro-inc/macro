/**
 * Views reachable from mobile navigation, in display order.
 * `search` is the "All" pill, first in the scope pill row;
 * `settings` navigates through the settings state (not `openWithSplit`), and
 * `calendar` and the drawer-only `reviews` shortcut are feature-gated.
 */
export const MOBILE_NAV_VIEW_IDS = [
  'search',
  'home',
  'calendar',
  'mail',
  'channels',
  'documents',
  'agents',
  'tasks',
  'reviews',
  'calls',
  'companies',
  'settings',
] as const;

export type MobileNavViewId = (typeof MOBILE_NAV_VIEW_IDS)[number];

export const isMobileNavViewId = (id: string): id is MobileNavViewId =>
  (MOBILE_NAV_VIEW_IDS as readonly string[]).includes(id);
