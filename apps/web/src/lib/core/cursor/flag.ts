import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableCursorAgents } from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';

/** Whether the built-in Cursor mention is included in this user's rollout. */
export function useCursorAgentsAccess(): Accessor<boolean> {
  const flag = useFeatureFlag(enableCursorAgents);
  return () => flag().enabled;
}
