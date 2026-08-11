import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  ENABLE_CHAT_V3_AGENTS_FLAG,
  ENABLE_CHAT_V3_AGENTS_OVERRIDE,
} from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';

/**
 * Whether the AI agents surfaces are enabled: the Macro Coder `@`-mention
 * entry and the folded agent-session view in channels. Reactive, so the
 * gated surfaces appear once PostHog answers rather than only on remount.
 */
export function useChatV3AgentsFlag(): Accessor<boolean> {
  const flag = useFeatureFlag(ENABLE_CHAT_V3_AGENTS_FLAG, {
    enabledOverride: ENABLE_CHAT_V3_AGENTS_OVERRIDE,
  });
  return () => flag().enabled;
}
