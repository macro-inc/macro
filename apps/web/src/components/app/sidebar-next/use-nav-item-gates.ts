import { useCalendarUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  ENABLE_CALLS,
  enableCrm,
  enableTasksReviews,
} from '@core/constant/featureFlags';
import { type Accessor, createMemo } from 'solid-js';
import type { NavItemGates } from './nav-items';
import { useSidebarPrefs } from './use-sidebar-prefs';

/**
 * Subscribes to the flags gating Calendar, Customers, Calls, and Reviews, so a
 * flag that resolves after mount still reaches the rendered list. Shared by the
 * sidebar's nav and the More menu so the two can't disagree about which apps
 * exist.
 */
export function useNavItemGates(): Accessor<NavItemGates> {
  const calendar = useCalendarUiFlag();
  const crm = useFeatureFlag(enableCrm);
  const reviews = useFeatureFlag(enableTasksReviews);
  const { prefs } = useSidebarPrefs();

  return createMemo(() => ({
    showCalendar: calendar(),
    showCustomers: crm().enabled,
    showCalls: ENABLE_CALLS,
    showReviews: reviews().enabled,
    prefs: prefs(),
  }));
}
