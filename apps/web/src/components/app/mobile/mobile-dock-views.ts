import { useCalendarUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { getIconConfig } from '@core/component/EntityIcon';
import { AnimatedInboxIcon } from '@icon/wide-inbox';
import BellIcon from '@phosphor/bell-simple.svg';
import { type Accessor, createMemo } from 'solid-js';
import type { MobileTouchIconComponent } from './MobileTouchMenu';
import type { MobileNavViewId } from './mobile-nav-views';

export type MobileDockView = {
  id: Exclude<MobileNavViewId, 'search' | 'settings'>;
  label: string;
  /** Views-menu row icon. */
  icon: MobileTouchIconComponent;
  /** Plain svg icons (e.g. the calendar) don't accept `triggerAnimation`. */
  animateIcon?: boolean;
  /** When set, the scope pill renders icon-only with this icon. */
  pillIcon?: MobileTouchIconComponent;
};

/**
 * The navigation views shared by the search scope pills (MobileViewsRow) and
 * the dock's Views menu (MoreViewsMenu), in canonical order: the pill row
 * renders it as-is after the "All" pill, the menu reversed so Notifications stays
 * nearest the thumb. "All" (pills only) and Settings (menu only) are
 * per-surface additions at the edges.
 */
const MOBILE_DOCK_VIEWS: MobileDockView[] = [
  {
    id: 'inbox',
    label: 'Notifications',
    icon: AnimatedInboxIcon,
    pillIcon: BellIcon,
  },
  {
    id: 'calendar',
    label: 'Calendar',
    icon: getIconConfig('calendar').icon,
    animateIcon: false,
    pillIcon: getIconConfig('calendar').icon,
  },
  {
    id: 'mail',
    label: 'Email',
    icon: getIconConfig('email').icon,
    animateIcon: false,
  },
  {
    id: 'channels',
    label: 'Channels',
    icon: getIconConfig('channel').icon,
    animateIcon: false,
  },
  {
    id: 'documents',
    label: 'Files',
    icon: getIconConfig('files').icon,
    animateIcon: false,
  },
  {
    id: 'agents',
    label: 'Agents',
    icon: getIconConfig('agent').icon,
    animateIcon: false,
  },
  {
    id: 'tasks',
    label: 'Tasks',
    icon: getIconConfig('task').icon,
    animateIcon: false,
  },
  {
    id: 'calls',
    label: 'Calls',
    icon: getIconConfig('call').icon,
    animateIcon: false,
  },
];

/** The dock views with feature gating applied (the calendar UI flag). */
export function useMobileDockViews(): Accessor<MobileDockView[]> {
  const calendarUiEnabled = useCalendarUiFlag();
  return createMemo(() =>
    MOBILE_DOCK_VIEWS.filter(
      (view) => view.id !== 'calendar' || calendarUiEnabled()
    )
  );
}
