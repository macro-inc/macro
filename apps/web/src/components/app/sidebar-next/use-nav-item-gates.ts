import { useActivityFeedFlag } from '@app/features/activity/use-activity-feed-flag';
import { useCalendarUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { useUnifiedNotificationsFlag } from '@app/features/notifications-inbox/use-unified-notifications-flag';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  ENABLE_CALLS,
  enableActivityFeed,
  enableCalendarScheduling,
  enableCalendarUi,
  enableCrm,
  enableGraphqlSoup,
  enableTasksReviews,
  enableUnifiedNotifications,
  enableWhatsappLinked,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { type Accessor, createMemo } from 'solid-js';
import type { NavItemGates } from './nav-items';
import { readSidebarPrefs, useSidebarPrefs } from './use-sidebar-prefs';

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
  const external = useFeatureFlag(enableWhatsappLinked);
  const { prefs } = useSidebarPrefs();

  return createMemo(() => ({
    showNotifications: notifications(),
    showCalendar: calendar(),
    showScheduling: scheduling().enabled,
    showCustomers: crm().enabled,
    showCalls: ENABLE_CALLS,
    showReviews: reviews().enabled,
    showActivity: activity(),
    showExternal: external().enabled,
    prefs: prefs(),
  }));
}

/**
 * The same gates, read once for a decision made outside a component, such as
 * which view opens by default. Keep in step with `useNavItemGates`. Flags that
 * have not loaded read as off, so a gated item is skipped until they do.
 */
export function readNavItemGates(): NavItemGates {
  return {
    showNotifications:
      isFeatureEnabled(enableUnifiedNotifications) &&
      isFeatureEnabled(enableGraphqlSoup),
    showCalendar: isFeatureEnabled(enableCalendarUi),
    showScheduling: isFeatureEnabled(enableCalendarScheduling),
    showCustomers: isFeatureEnabled(enableCrm),
    showCalls: ENABLE_CALLS,
    showReviews: isFeatureEnabled(enableTasksReviews),
    showActivity: isFeatureEnabled(enableActivityFeed),
    showExternal: isFeatureEnabled(enableWhatsappLinked),
    prefs: readSidebarPrefs(),
  };
}
