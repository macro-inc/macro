import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableChatV3Agents } from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';

/**
 * Whether the AI agents surfaces are enabled: the Macro Coder `@`-mention
 * entry, the folded agent-session view in channels, and whether `@macro`
 * opens an agent session instead of the classic reply. Reactive, so the
 * gated surfaces appear once PostHog answers rather than only on remount.
 */
export function useChatV3AgentsFlag(): Accessor<boolean> {
  const flag = useFeatureFlag(enableChatV3Agents);
  return () => flag().enabled;
}
