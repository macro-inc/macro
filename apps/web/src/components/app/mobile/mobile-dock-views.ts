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
import { createMemo } from 'solid-js';
import type { MobileTouchIconComponent } from './MobileTouchMenu';
import type { MobileNavViewId } from './mobile-nav-views';

export type MobileDockView = {
  id: Exclude<MobileNavViewId, 'search' | 'settings'>;
  label: string;
  /** Same Phosphor glyph as the desktop sidebar. */
  icon: MobileTouchIconComponent;
  iconActive?: MobileTouchIconComponent;
  /** When set, the scope pill renders icon-only with this icon. */
  pillIcon?: MobileTouchIconComponent;
};

/**
 * Shared navigation order for the dock and search scope pills. The dock shows
 * as many views as fit and puts the remainder in More. All and Settings are
 * added by their respective surfaces.
 */
const MOBILE_DOCK_VIEWS: readonly MobileDockView[] = [
  {
    id: 'inbox',
    label: 'Notifications',
    icon: BellIcon,
    iconActive: BellFillIcon,
    pillIcon: BellIcon,
  },
  {
    id: 'calendar',
    label: 'Calendar',
    icon: CalendarIcon,
    iconActive: CalendarFillIcon,
    pillIcon: CalendarIcon,
  },
  {
    id: 'mail',
    label: 'Email',
    icon: EmailIcon,
    iconActive: EmailFillIcon,
  },
  {
    id: 'channels',
    label: 'Channels',
    icon: ChatsIcon,
    iconActive: ChatsFillIcon,
  },
  {
    id: 'documents',
    label: 'Files',
    icon: FilesIcon,
    iconActive: FilesFillIcon,
  },
  { id: 'agents', label: 'Agents', icon: AgentsIcon },
  { id: 'tasks', label: 'Tasks', icon: TasksIcon },
  { id: 'calls', label: 'Calls', icon: CallsIcon },
];

export function useMobileDockViews() {
  const calendarEnabled = useCalendarUiFlag();
  return createMemo(() =>
    MOBILE_DOCK_VIEWS.filter(
      (view) => view.id !== 'calendar' || calendarEnabled()
    )
  );
}
