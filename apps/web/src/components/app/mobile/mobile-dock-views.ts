import { useCalendarUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { getIconConfig } from '@core/component/EntityIcon';
import {
  enableCalendarScheduling,
  enableCrm,
  enableTasksReviews,
} from '@core/constant/featureFlags';
import BellIcon from '@phosphor/bell.svg';
import CalendarCheckIcon from '@phosphor/calendar-check.svg';
import ChatsCircleIcon from '@phosphor/chats-circle.svg';
import GitPullRequestIcon from '@phosphor/git-pull-request.svg';
import BellFillIcon from '@phosphor-fill/bell-fill.svg';
import CalendarFillIcon from '@phosphor-fill/calendar-fill.svg';
import ChatsCircleFillIcon from '@phosphor-fill/chats-circle-fill.svg';
import EmailFillIcon from '@phosphor-fill/envelope-fill.svg';
import FilesFillIcon from '@phosphor-fill/files-fill.svg';
import { createMemo } from 'solid-js';
import type { MobileDockIcon } from './MobileDockButton';
import type { MobileNavViewId } from './mobile-nav-views';

export type MobileDockView = {
  id: Exclude<MobileNavViewId, 'search' | 'settings'>;
  label: string;
  /** Phosphor glyph for this view. */
  icon: MobileDockIcon;
  iconActive?: MobileDockIcon;
};

/**
 * Dock navigation order. Views that do not fit go in More; Settings is
 * added by its own surface.
 */
export const MOBILE_DOCK_VIEWS: readonly MobileDockView[] = [
  {
    id: 'home',
    label: 'Notifications',
    icon: BellIcon,
    iconActive: BellFillIcon,
  },
  {
    id: 'calendar',
    label: 'Calendar',
    icon: getIconConfig('calendar').icon,
    iconActive: CalendarFillIcon,
  },
  {
    id: 'mail',
    label: 'Email',
    icon: getIconConfig('email').icon,
    iconActive: EmailFillIcon,
  },
  {
    id: 'channels',
    label: 'Chat',
    icon: ChatsCircleIcon,
    iconActive: ChatsCircleFillIcon,
  },
  { id: 'agents', label: 'Agents', icon: getIconConfig('agent').icon },
  {
    id: 'documents',
    label: 'Files',
    icon: getIconConfig('files').icon,
    iconActive: FilesFillIcon,
  },
  { id: 'tasks', label: 'Tasks', icon: getIconConfig('task').icon },
  { id: 'calls', label: 'Calls', icon: getIconConfig('call').icon },
  { id: 'companies', label: 'CRM', icon: getIconConfig('company').icon },
  { id: 'reviews', label: 'Reviews', icon: GitPullRequestIcon },
  { id: 'booking-links', label: 'Scheduling', icon: CalendarCheckIcon },
];

export function useMobileDockViews() {
  const calendarEnabled = useCalendarUiFlag();
  const crm = useFeatureFlag(enableCrm);
  const reviews = useFeatureFlag(enableTasksReviews);
  const scheduling = useFeatureFlag(enableCalendarScheduling);
  return createMemo(() =>
    MOBILE_DOCK_VIEWS.filter(
      (view) => view.id !== 'calendar' || calendarEnabled()
    )
      .filter((view) => view.id !== 'companies' || crm().enabled)
      .filter((view) => view.id !== 'reviews' || reviews().enabled)
      .filter((view) => view.id !== 'booking-links' || scheduling().enabled)
  );
}
