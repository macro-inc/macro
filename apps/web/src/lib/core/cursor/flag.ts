import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { isMacroStaffEmail } from '@core/constant/cursorAgent';
import { enableCursorAgents } from '@core/constant/featureFlags';
import { useEmail } from '@core/context/user';
import type { Accessor } from 'solid-js';

/** Whether the current user may see and use Cursor-agent surfaces. */
export function useCursorAgentsAccess(): Accessor<boolean> {
  const flag = useFeatureFlag(enableCursorAgents);
  const email = useEmail();

  return () => flag().enabled && isMacroStaffEmail(email());
}
