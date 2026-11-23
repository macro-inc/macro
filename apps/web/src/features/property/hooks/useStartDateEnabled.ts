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
