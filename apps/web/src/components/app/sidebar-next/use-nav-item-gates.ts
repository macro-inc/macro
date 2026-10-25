import { useActivityFeedFlag } from '@app/features/activity/use-activity-feed-flag';
import { useCalendarUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  ENABLE_CALLS,
  enableCalendarScheduling,
  enableCrm,
  enableTasksReviews,
} from '@core/constant/featureFlags';
import { type Accessor, createMemo } from 'solid-js';
import type { NavItemGates } from './nav-items';
import { useSidebarPrefs } from './use-sidebar-prefs';

/**
 * Subscribes to feature flags so flags that resolve after mount reach the
 * rendered list. Shared by the sidebar's nav and the More menu so the two
 * agree about which apps exist.
 */
export function useNavItemGates(): Accessor<NavItemGates> {
  const calendar = useCalendarUiFlag();
  const scheduling = useFeatureFlag(enableCalendarScheduling);
  const crm = useFeatureFlag(enableCrm);
  const reviews = useFeatureFlag(enableTasksReviews);
  const activity = useActivityFeedFlag();
  const { prefs } = useSidebarPrefs();

  return createMemo(() => ({
    showCalendar: calendar(),
    showScheduling: scheduling().enabled,
    showCustomers: crm().enabled,
    showCalls: ENABLE_CALLS,
    showReviews: reviews().enabled,
    showActivity: activity(),
    prefs: prefs(),
  }));
}
