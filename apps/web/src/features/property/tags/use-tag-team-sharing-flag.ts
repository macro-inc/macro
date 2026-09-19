import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableTagTeamSharing } from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';

/**
 * Whether a personal tag may be shared with the team. Gates only the entry
 * point — the backend endpoints are ungated, so anything already promoted
 * stays promoted when this is off.
 */
export function useTagTeamSharingFlag(): Accessor<boolean> {
  const flag = useFeatureFlag(enableTagTeamSharing);
  return () => flag().enabled;
}
