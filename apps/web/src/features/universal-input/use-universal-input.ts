import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  enableSelectionOffer,
  enableUniversalInput,
} from '@core/constant/featureFlags';

/** The rollout flag is the only control for enabling Universal Input. */
export function useUniversalInputEnabled() {
  const flag = useFeatureFlag(enableUniversalInput);
  return () => !flag().loading && flag().enabled;
}

/** Selected text is offered a draft only where Universal Input itself runs. */
export function useSelectionOfferEnabled() {
  const universalInput = useUniversalInputEnabled();
  const flag = useFeatureFlag(enableSelectionOffer);
  return () => universalInput() && !flag().loading && flag().enabled;
}
