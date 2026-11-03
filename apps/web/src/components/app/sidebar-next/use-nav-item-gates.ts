import { useActivityFeedFlag } from '@app/features/activity/use-activity-feed-flag';
import { useCalendarUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  ENABLE_CALLS,
  enableCalendarScheduling,
  enableCrm,
  enableForYou,
  enableTasksReviews,
  enableWhatsappLinked,
} from '@core/constant/featureFlags';
import { type Accessor, createMemo } from 'solid-js';
import type { GatedNavId, NavItemGates } from './nav-items';
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
  const external = useFeatureFlag(enableWhatsappLinked);
  const forYou = useFeatureFlag(enableForYou);
  const { prefs } = useSidebarPrefs();

  return createMemo(() => ({
    enabled: (
      [
        { id: 'for-you', enabled: forYou().enabled },
        { id: 'calendar', enabled: calendar() },
        { id: 'booking-links', enabled: scheduling().enabled },
        { id: 'companies', enabled: crm().enabled },
        { id: 'calls', enabled: ENABLE_CALLS },
        { id: 'reviews', enabled: reviews().enabled },
        { id: 'activity', enabled: activity() },
        { id: 'external', enabled: external().enabled },
      ] satisfies { id: GatedNavId; enabled: boolean }[]
    )
      .filter((item) => item.enabled)
      .map((item) => item.id),
    prefs: prefs(),
  }));
}
