import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableSubRoutines } from '@core/constant/featureFlags';

/** The owner's rollout, unresolved until the flag reader is ready. */
export function useSubRoutineWrites() {
  const flag = useFeatureFlag(enableSubRoutines);
  return () => (flag().loading ? undefined : flag().enabled);
}
