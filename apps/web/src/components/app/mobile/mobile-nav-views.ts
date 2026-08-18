/**
 * Views reachable from the mobile navigation pill row, in display order.
 * `settings` navigates through the settings state (not `openWithSplit`), and
 * `calendar` is additionally gated by the calendar UI flag.
 */
export const MOBILE_NAV_VIEW_IDS = [
  'inbox',
  'calendar',
  'mail',
  'channels',
  'documents',
  'agents',
  'tasks',
  'calls',
  'settings',
] as const;

export type MobileNavViewId = (typeof MOBILE_NAV_VIEW_IDS)[number];

export const isMobileNavViewId = (id: string): id is MobileNavViewId =>
  (MOBILE_NAV_VIEW_IDS as readonly string[]).includes(id);
