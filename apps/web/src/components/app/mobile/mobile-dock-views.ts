import { useCalendarUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { getIconConfig } from '@core/component/EntityIcon';
import { enableCrm } from '@core/constant/featureFlags';
import BellFillIcon from '@icon/system/fill/bell-fill.svg';
import CalendarFillIcon from '@icon/system/fill/calendar-fill.svg';
import EmailFillIcon from '@icon/system/fill/envelope-fill.svg';
import FilesFillIcon from '@icon/system/fill/files-fill.svg';
import ChannelFillIcon from '@icon/system/fill/hash-straight-fill.svg';
import BellIcon from '@icon/system/regular/bell.svg';
import { createMemo } from 'solid-js';
import type { MobileDockIcon } from './MobileDockButton';
import type { MobileNavViewId } from './mobile-nav-views';

export type MobileDockView = {
  id: Exclude<MobileNavViewId, 'search' | 'settings'>;
  label: string;
  /** Phosphor glyph for this view. */
  icon: MobileDockIcon;
  iconActive?: MobileDockIcon;
  /** When set, the scope pill renders icon-only with this icon. */
  pillIcon?: MobileDockIcon;
};

/**
 * Shared navigation order for the dock and search scope pills. The dock shows
 * as many views as fit and puts the remainder in More. All and Settings are
 * added by their respective surfaces.
 */
const MOBILE_DOCK_VIEWS: readonly MobileDockView[] = [
  {
    id: 'home',
    label: 'Notifications',
    icon: BellIcon,
    iconActive: BellFillIcon,
    pillIcon: BellIcon,
  },
  {
    id: 'calendar',
    label: 'Calendar',
    icon: getIconConfig('calendar').icon,
    iconActive: CalendarFillIcon,
    pillIcon: getIconConfig('calendar').icon,
  },
  {
    id: 'mail',
    label: 'Email',
    icon: getIconConfig('email').icon,
    iconActive: EmailFillIcon,
  },
  {
    id: 'channels',
    label: 'Channels',
    icon: getIconConfig('channel').icon,
    iconActive: ChannelFillIcon,
  },
  {
    id: 'documents',
    label: 'Files',
    icon: getIconConfig('files').icon,
    iconActive: FilesFillIcon,
  },
  { id: 'agents', label: 'Agents', icon: getIconConfig('agent').icon },
  { id: 'tasks', label: 'Tasks', icon: getIconConfig('task').icon },
  { id: 'calls', label: 'Calls', icon: getIconConfig('call').icon },
  { id: 'companies', label: 'CRM', icon: getIconConfig('company').icon },
];

export function useMobileDockViews() {
  const calendarEnabled = useCalendarUiFlag();
  const crm = useFeatureFlag(enableCrm);
  return createMemo(() =>
    MOBILE_DOCK_VIEWS.filter(
      (view) => view.id !== 'calendar' || calendarEnabled()
    ).filter((view) => view.id !== 'companies' || crm().enabled)
  );
}
