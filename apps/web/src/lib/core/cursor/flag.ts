import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableCursorAgents } from '@core/constant/featureFlags';
import { useEmail } from '@core/context/user';
import type { Accessor } from 'solid-js';
import { isMacroStaffEmail } from './staff';

/** Whether the current user may see and use Cursor-agent surfaces. */
export function useCursorAgentsAccess(): Accessor<boolean> {
  const flag = useFeatureFlag(enableCursorAgents);
  const email = useEmail();

  return () => flag().enabled && isMacroStaffEmail(email());
}
