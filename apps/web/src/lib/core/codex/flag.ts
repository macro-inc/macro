import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  enableChatV3Agents,
  enableCodexAgents,
} from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';

/** Codex surfaces require both the agent rollout and the Codex rollout. */
export function useCodexAgentsAccess(): Accessor<boolean> {
  const agents = useFeatureFlag(enableChatV3Agents);
  const codex = useFeatureFlag(enableCodexAgents);
  return () => agents().enabled && codex().enabled;
}
