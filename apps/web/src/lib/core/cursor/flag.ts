import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableCursorAgents } from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';

/** Whether the current user may see and use Cursor-agent surfaces. */
export function useCursorAgentsAccess(): Accessor<boolean> {
  const flag = useFeatureFlag(enableCursorAgents);

  return () => flag().enabled;
}
