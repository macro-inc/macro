import { useCalendarUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import BellIcon from '@phosphor/bell.svg';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import ChatsIcon from '@phosphor/chats-circle.svg';
import EmailIcon from '@phosphor/envelope.svg';
import FilesIcon from '@phosphor/folder-simple.svg';
import TasksIcon from '@phosphor/list-checks.svg';
import CallsIcon from '@phosphor/phone.svg';
import AgentsIcon from '@phosphor/sparkle.svg';
import BellFillIcon from '@phosphor-fill/bell-fill.svg';
import CalendarFillIcon from '@phosphor-fill/calendar-blank-fill.svg';
import ChatsFillIcon from '@phosphor-fill/chats-circle-fill.svg';
import EmailFillIcon from '@phosphor-fill/envelope-fill.svg';
import FilesFillIcon from '@phosphor-fill/folder-simple-fill.svg';
import { type Accessor, createMemo } from 'solid-js';
import type { MobileTouchIconComponent } from './MobileTouchMenu';
import type { MobileNavViewId } from './mobile-nav-views';

export type MobileDockView = {
  id: Exclude<MobileNavViewId, 'search' | 'settings'>;
  label: string;
  /** Shown directly in the compact dock instead of its More menu. */
  compact?: boolean;
  /** Same Phosphor glyph as the desktop sidebar. */
  icon: MobileTouchIconComponent;
  iconActive?: MobileTouchIconComponent;
  /** Plain svg icons (e.g. the calendar) don't accept `triggerAnimation`. */
  animateIcon?: boolean;
  /** When set, the scope pill renders icon-only with this icon. */
  pillIcon?: MobileTouchIconComponent;
};

/**
 * The navigation views shared by the search scope pills (MobileViewsRow) and
 * the dock's Views menu (MoreViewsMenu), in canonical order: the pill row
 * renders it as-is after the "All" pill; the menu reverses only the views
 * not already in the compact dock. "All" (pills only) and Settings (menu only) are
 * per-surface additions at the edges.
 */
const MOBILE_DOCK_VIEWS: MobileDockView[] = [
  {
    id: 'inbox',
    compact: true,
    label: 'Notifications',
    icon: BellIcon,
    iconActive: BellFillIcon,
    pillIcon: BellIcon,
  },
  {
    id: 'calendar',
    compact: true,
    label: 'Calendar',
    icon: CalendarIcon,
    iconActive: CalendarFillIcon,
    animateIcon: false,
    pillIcon: CalendarIcon,
  },
  {
    compact: true,
    id: 'mail',
    label: 'Email',
    icon: EmailIcon,
    iconActive: EmailFillIcon,
  },
  {
    compact: true,
    id: 'channels',
    label: 'Channels',
    icon: ChatsIcon,
    iconActive: ChatsFillIcon,
  },
  {
    compact: true,
    id: 'documents',
    label: 'Files',
    icon: FilesIcon,
    iconActive: FilesFillIcon,
  },
  { id: 'agents', label: 'Agents', icon: AgentsIcon },
  { id: 'tasks', label: 'Tasks', icon: TasksIcon },
  { id: 'calls', label: 'Calls', icon: CallsIcon },
];

/** The dock views with feature gating applied (the calendar UI flag). */
export function useMobileDockViews(): Accessor<MobileDockView[]> {
  const calendarUiEnabled = useCalendarUiFlag();
  return createMemo(() =>
    MOBILE_DOCK_VIEWS.map((view) => ({ ...view, animateIcon: false })).filter(
      (view) => view.id !== 'calendar' || calendarUiEnabled()
    )
  );
}
