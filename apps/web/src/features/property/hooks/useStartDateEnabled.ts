import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableTaskStartDate } from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';

/**
 * Whether tasks and projects show and edit a Start Date beside the due date.
 * Off while the flag loads, so the dates look as they always have until then.
 */
export function useStartDateEnabled(): Accessor<boolean> {
  const flag = useFeatureFlag(enableTaskStartDate);
  return () => flag().enabled;
}

/**
 * Whether start dates are known to be off: false while the flag loads, so
 * stored start-date settings are not dropped before the flag answers.
 */
export function useStartDatesOff(): Accessor<boolean> {
  const flag = useFeatureFlag(enableTaskStartDate);
  return () => !flag().loading && !flag().enabled;
}
