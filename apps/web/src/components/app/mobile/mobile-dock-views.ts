import { useCalendarUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { getIconConfig } from '@core/component/EntityIcon';
import { enableCrm } from '@core/constant/featureFlags';
import BellIcon from '@phosphor/bell.svg';
import BellFillIcon from '@phosphor-fill/bell-fill.svg';
import CalendarFillIcon from '@phosphor-fill/calendar-fill.svg';
import EmailFillIcon from '@phosphor-fill/envelope-fill.svg';
import FilesFillIcon from '@phosphor-fill/files-fill.svg';
import ChannelFillIcon from '@phosphor-fill/hash-straight-fill.svg';
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
const MOBILE_DOCK_VIEWS: readonly MobileDockView[] = [
  {
    id: 'home',
    get label() {
      return t('nav.notifications');
    },
    icon: BellIcon,
    iconActive: BellFillIcon,
  },
  {
    id: 'calendar',
    get label() {
      return t('nav.calendar');
    },
    icon: getIconConfig('calendar').icon,
    iconActive: CalendarFillIcon,
  },
  {
    id: 'mail',
    get label() {
      return t('nav.email');
    },
    icon: getIconConfig('email').icon,
    iconActive: EmailFillIcon,
  },
  {
    id: 'channels',
    get label() {
      return t('nav.channels');
    },
    icon: getIconConfig('channel').icon,
    iconActive: ChannelFillIcon,
  },
  {
    id: 'agents',
    get label() {
      return t('nav.agents');
    },
    icon: getIconConfig('agent').icon,
  },
  {
    id: 'documents',
    get label() {
      return t('nav.files');
    },
    icon: getIconConfig('files').icon,
    iconActive: FilesFillIcon,
  },
  {
    id: 'tasks',
    get label() {
      return t('nav.tasks');
    },
    icon: getIconConfig('task').icon,
  },
  {
    id: 'calls',
    get label() {
      return t('nav.calls');
    },
    icon: getIconConfig('call').icon,
  },
  {
    id: 'companies',
    get label() {
      return t('mobile.crm');
    },
    icon: getIconConfig('company').icon,
  },
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
