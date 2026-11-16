import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableMicrosoftSignup } from '@core/constant/featureFlags';
import { useOutlookAvailable } from '@queries/auth/outlook-link';
import type { Accessor } from 'solid-js';

/**
 * Whether onboarding's work step offers Outlook beside Google: Microsoft
 * sign-up is on and the server lets this user connect Outlook. The server is
 * asked only while the flag is on.
 */
export function createAppOutlookAvailability(): Accessor<boolean> {
  const microsoft = useFeatureFlag(enableMicrosoftSignup);
  const outlook = useOutlookAvailable(() => microsoft().enabled);
  return () => microsoft().enabled && outlook();
}
