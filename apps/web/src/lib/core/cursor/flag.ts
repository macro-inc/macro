import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableCursorAgents } from '@core/constant/featureFlags';
import { useEmail } from '@core/context/user';
import type { Accessor } from 'solid-js';

/** Whether an email belongs to a Macro staff account. */
export function isMacroStaffEmail(email: string | undefined): boolean {
  const parts = email?.toLowerCase().split('@');
  return parts?.length === 2 && parts[1] === 'macro.com';
}

/** Whether the current user may see and use Cursor-agent surfaces. */
export function useCursorAgentsAccess(): Accessor<boolean> {
  const flag = useFeatureFlag(enableCursorAgents);
  const email = useEmail();

  return () => flag().enabled && isMacroStaffEmail(email());
}
