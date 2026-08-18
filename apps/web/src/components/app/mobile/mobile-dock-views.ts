import { useCalendarUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import WideCalendarIcon from '@icon/wide-calendar.svg';
import { AnimatedCallIcon } from '@icon/wide-call';
import { AnimatedChannelIcon } from '@icon/wide-channel';
import { AnimatedEmailIcon } from '@icon/wide-email';
import { AnimatedFileMdIcon } from '@icon/wide-fileMd';
import { AnimatedInboxIcon } from '@icon/wide-inbox';
import { AnimatedStarIcon } from '@icon/wide-star';
import { AnimatedTaskIcon } from '@icon/wide-task';
import BellIcon from '@phosphor/bell-simple.svg';
import { type Accessor, createMemo } from 'solid-js';
import type { MobileTouchIconComponent } from './MobileTouchMenu';
import type { MobileNavViewId } from './mobile-nav-views';

export type MobileDockView = {
  id: Exclude<MobileNavViewId, 'search' | 'settings'>;
  label: string;
  /** Views-menu row icon (animated where available). */
  icon: MobileTouchIconComponent;
  /** Plain svg icons (e.g. the calendar) don't accept `triggerAnimation`. */
  animateIcon?: boolean;
  /** When set, the scope pill renders icon-only with this icon. */
  pillIcon?: MobileTouchIconComponent;
};

/**
 * The navigation views shared by the search scope pills (MobileViewsRow) and
 * the dock's Views menu (MoreViewsMenu), in canonical order: the pill row
 * renders it as-is after the "All" pill, the menu reversed so Inbox stays
 * nearest the thumb. "All" (pills only) and Settings (menu only) are
 * per-surface additions at the edges.
 */
const MOBILE_DOCK_VIEWS: MobileDockView[] = [
  { id: 'inbox', label: 'Inbox', icon: AnimatedInboxIcon, pillIcon: BellIcon },
  {
    id: 'calendar',
    label: 'Calendar',
    icon: WideCalendarIcon,
    animateIcon: false,
    pillIcon: WideCalendarIcon,
  },
  { id: 'mail', label: 'Email', icon: AnimatedEmailIcon },
  { id: 'channels', label: 'Channels', icon: AnimatedChannelIcon },
  { id: 'documents', label: 'Files', icon: AnimatedFileMdIcon },
  { id: 'agents', label: 'Agents', icon: AnimatedStarIcon },
  { id: 'tasks', label: 'Tasks', icon: AnimatedTaskIcon },
  { id: 'calls', label: 'Calls', icon: AnimatedCallIcon },
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
