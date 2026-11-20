import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableSuggestions } from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { Accessor } from 'solid-js';

/**
 * Whether the For you page, its sidebar entry and Home's priorities are
 * shown: `enable-suggestions` on, and not a touch device, where suggestions have no
 * design yet.
 */
export function useSuggestionsFlag(): Accessor<boolean> {
  const flag = useFeatureFlag(enableSuggestions);

  return () => flag().enabled && !isTouchDevice();
}
