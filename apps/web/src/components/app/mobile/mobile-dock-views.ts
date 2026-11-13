import { useCalendarUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { getIconConfig } from '@core/component/EntityIcon';
import {
  enableCalendarScheduling,
  enableCrm,
  enablePasswords,
  enableProjects,
  enableTasksReviews,
  enableWhatsappLinked,
} from '@core/constant/featureFlags';
import BellFillIcon from '@icon/system/fill/bell-fill.svg';
import BuildingsFillIcon from '@icon/system/fill/buildings-fill.svg';
import CalendarBlankFillIcon from '@icon/system/fill/calendar-blank-fill.svg';
import ChatsCircleFillIcon from '@icon/system/fill/chats-circle-fill.svg';
import EmailFillIcon from '@icon/system/fill/envelope-fill.svg';
import FolderSimpleFillIcon from '@icon/system/fill/folder-simple-fill.svg';
import GitPullRequestFillIcon from '@icon/system/fill/git-pull-request-fill.svg';
import ListChecksFillIcon from '@icon/system/fill/list-checks-fill.svg';
import LockFillIcon from '@icon/system/fill/lock-fill.svg';
import PhoneCallFillIcon from '@icon/system/fill/phone-call-fill.svg';
import PlugFillIcon from '@icon/system/fill/plug-fill.svg';
import AgentFillIcon from '@icon/system/fill/sparkle-fill.svg';
import BellIcon from '@icon/system/regular/bell.svg';
import BuildingsIcon from '@icon/system/regular/buildings.svg';
import CalendarBlankIcon from '@icon/system/regular/calendar-blank.svg';
import CalendarCheckIcon from '@icon/system/regular/calendar-check.svg';
import ChatsCircleIcon from '@icon/system/regular/chats-circle.svg';
import CubeIcon from '@icon/system/regular/cube.svg';
import FolderSimpleIcon from '@icon/system/regular/folder-simple.svg';
import GitPullRequestIcon from '@icon/system/regular/git-pull-request.svg';
import LockIcon from '@icon/system/regular/lock.svg';
import PlugIcon from '@icon/system/regular/plug.svg';
import { useCurrentTeamQuery } from '@queries/team/teams';
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
    icon: CalendarBlankIcon,
    iconActive: CalendarBlankFillIcon,
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
      return t('nav.chat');
    },
    icon: ChatsCircleIcon,
    iconActive: ChatsCircleFillIcon,
  },
  {
    id: 'agents',
    get label() {
      return t('nav.agents');
    },
    icon: getIconConfig('agent').icon,
    iconActive: AgentFillIcon,
  },
  {
    id: 'documents',
    get label() {
      return t('nav.files');
    },
    icon: FolderSimpleIcon,
    iconActive: FolderSimpleFillIcon,
  },
  {
    id: 'passwords',
    get label() {
      return t('passwords.title');
    },
    icon: LockIcon,
    iconActive: LockFillIcon,
  },
  {
    id: 'tasks',
    get label() {
      return t('nav.tasks');
    },
    icon: getIconConfig('task').icon,
    iconActive: ListChecksFillIcon,
  },
  {
    id: 'projects',
    get label() {
      return t('viewMenus.projects');
    },
    icon: CubeIcon,
  },
  {
    id: 'calls',
    get label() {
      return t('nav.calls');
    },
    icon: getIconConfig('call').icon,
    iconActive: PhoneCallFillIcon,
  },
  {
    id: 'companies',
    get label() {
      return t('nav.customers');
    },
    icon: BuildingsIcon,
    iconActive: BuildingsFillIcon,
  },
  {
    id: 'reviews',
    get label() {
      return t('nav.reviews');
    },
    icon: GitPullRequestIcon,
    iconActive: GitPullRequestFillIcon,
  },
  {
    id: 'booking-links',
    get label() {
      return t('nav.scheduling');
    },
    icon: CalendarCheckIcon,
  },
  {
    id: 'external',
    get label() {
      return t('nav.external');
    },
    icon: PlugIcon,
    iconActive: PlugFillIcon,
  },
];

export function useMobileDockViews() {
  const calendarEnabled = useCalendarUiFlag();
  const crm = useFeatureFlag(enableCrm);
  const reviews = useFeatureFlag(enableTasksReviews);
  const scheduling = useFeatureFlag(enableCalendarScheduling);
  const passwords = useFeatureFlag(enablePasswords);
  const team = useCurrentTeamQuery(() => passwords().enabled);
  const passwordsAvailable = () =>
    passwords().enabled && team.isSuccess && Boolean(team.data?.team);
  const external = useFeatureFlag(enableWhatsappLinked);
  const projects = useFeatureFlag(enableProjects);
  return createMemo(() =>
    MOBILE_DOCK_VIEWS.filter(
      (view) => view.id !== 'calendar' || calendarEnabled()
    )
      .filter((view) => view.id !== 'companies' || crm().enabled)
      .filter((view) => view.id !== 'reviews' || reviews().enabled)
      .filter((view) => view.id !== 'booking-links' || scheduling().enabled)
      .filter((view) => view.id !== 'passwords' || passwordsAvailable())
      .filter((view) => view.id !== 'external' || external().enabled)
      .filter((view) => view.id !== 'projects' || projects().enabled)
  );
}
