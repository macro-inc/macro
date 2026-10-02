import { useCalendarUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  ENABLE_CALLS,
  enableCrm,
  enableReminders,
  enableTasksReviews,
} from '@core/constant/featureFlags';
import { type Accessor, createMemo } from 'solid-js';
import type { NavItemGates } from './nav-items';
import { useSidebarPinnedItems } from './use-sidebar-pinned-items';

/**
 * Subscribes to the flags gating the Calendar, Customers, Calls, and Reviews
 * rows, so a flag that resolves after mount still reaches the rendered list.
 * Shared by the sidebar's nav and the More Apps grid so the two can't disagree
 * about which apps exist.
 */
export function useNavItemGates(): Accessor<NavItemGates> {
  const calendar = useCalendarUiFlag();
  const crm = useFeatureFlag(enableCrm);
  const reminders = useFeatureFlag(enableReminders);
  const reviews = useFeatureFlag(enableTasksReviews);
  const pinnedItems = useSidebarPinnedItems();

  return createMemo(() => ({
    showCalendar: calendar(),
    showCustomers: crm().enabled,
    showReminders: reminders().enabled,
    showCalls: ENABLE_CALLS,
    showReviews: reviews().enabled,
    pinnedItems: pinnedItems(),
  }));
}
