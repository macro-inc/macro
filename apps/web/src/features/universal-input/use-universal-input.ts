import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  enableChannelUniversalInput,
  enableUniversalInput,
} from '@core/constant/featureFlags';

/** The rollout flag is the only control for enabling Universal Input. */
export function useUniversalInputEnabled() {
  const flag = useFeatureFlag(enableUniversalInput);
  return () => !flag().loading && flag().enabled;
}

/** Channel composers need Universal Input itself plus their own rollout. */
export function useChannelUniversalInputEnabled() {
  const universalInput = useUniversalInputEnabled();
  const flag = useFeatureFlag(enableChannelUniversalInput);
  return () => universalInput() && !flag().loading && flag().enabled;
}
