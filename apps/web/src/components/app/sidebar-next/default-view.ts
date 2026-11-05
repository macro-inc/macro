import { CALENDAR_VIEW_ID } from '@app/features/calendar-view/types';
import type { SplitContent } from '@components/app/split-layout/layoutManager';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  defaultNavItem,
  HOME_NAV_ITEM,
  type SidebarNextNavItem,
} from './nav-items';
import { readNavItemGates } from './use-nav-item-gates';

/**
 * The view the app opens when nobody picked one: at launch, in a new split or
 * tab, when the last split closes, and when a view sends its split away. It
 * is the rail's first button, read at the moment of the decision. Touch
 * devices have no rail and always land on Home.
 */
export function defaultView(): SidebarNextNavItem {
  if (isTouchDevice()) return HOME_NAV_ITEM;

  return defaultNavItem(readNavItemGates());
}

/** `defaultView` as split content, as the rail opens it. */
export function defaultViewContent(): SplitContent {
  const { id, params } = defaultView();
  return {
    type: 'component',
    id: id === 'calendar' ? CALENDAR_VIEW_ID : id,
    params,
  };
}
