import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableCodexAgents } from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';

/** Whether the Codex surfaces are rolled out to this user. */
export function useCodexAgentsAccess(): Accessor<boolean> {
  const codex = useFeatureFlag(enableCodexAgents);
  return () => codex().enabled;
}
