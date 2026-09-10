import { useCalendarUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableCrm } from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';
import type { NavItemGates } from './nav-items';

/**
 * Subscribes to the flags gating the Calendar and Customers rows, so a flag
 * that resolves after mount still reaches the rendered list. Shared by the
 * sidebar's nav and the More Apps grid so the two can't disagree about which
 * apps exist.
 */
export function useNavItemGates(): Accessor<NavItemGates> {
  const calendar = useCalendarUiFlag();
  const crm = useFeatureFlag(enableCrm);
  return () => ({
    showCalendar: calendar(),
    showCustomers: crm().enabled,
  });
}
