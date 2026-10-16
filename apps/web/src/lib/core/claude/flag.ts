import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { claudeCloud } from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';

/** Whether the built-in Claude agent is included in this user's rollout. */
export function useClaudeAgentsAccess(): Accessor<boolean> {
  const flag = useFeatureFlag(claudeCloud);
  return () => flag().enabled;
}
