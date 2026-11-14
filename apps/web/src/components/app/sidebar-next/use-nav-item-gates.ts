import { useActivityFeedFlag } from '@app/features/activity/use-activity-feed-flag';
import { useCalendarUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { useEnabledProviders } from '@app/features/external-view/provider-flags';
import { useUnifiedNotificationsFlag } from '@app/features/notifications-inbox/use-unified-notifications-flag';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  ENABLE_CALLS,
  enableCalendarScheduling,
  enableCrm,
  enablePasswords,
  enableTasksReviews,
} from '@core/constant/featureFlags';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { type Accessor, createMemo } from 'solid-js';
import type { NavItemGates } from './nav-items';
import { useSidebarPrefs } from './use-sidebar-prefs';

/**
 * Subscribes to feature flags so flags that resolve after mount reach the
 * rendered list. Shared by the sidebar's nav and the More menu so the two
 * agree about which apps exist.
 */
export function useNavItemGates(): Accessor<NavItemGates> {
  const notifications = useUnifiedNotificationsFlag();
  const calendar = useCalendarUiFlag();
  const scheduling = useFeatureFlag(enableCalendarScheduling);
  const crm = useFeatureFlag(enableCrm);
  const reviews = useFeatureFlag(enableTasksReviews);
  const activity = useActivityFeedFlag();
  const passwords = useFeatureFlag(enablePasswords);
  const team = useCurrentTeamQuery(() => passwords().enabled);
  const externalProviders = useEnabledProviders();
  const { prefs } = useSidebarPrefs();

  return createMemo(() => ({
    showNotifications: notifications(),
    showCalendar: calendar(),
    showScheduling: scheduling().enabled,
    showCustomers: crm().enabled,
    showCalls: ENABLE_CALLS,
    showReviews: reviews().enabled,
    showActivity: activity(),
    // Passwords is a team vault: no team, no entry at all.
    showPasswords:
      passwords().enabled && team.isSuccess && Boolean(team.data?.team),
    showExternal: externalProviders().providers.length > 0,
    prefs: prefs(),
  }));
}
