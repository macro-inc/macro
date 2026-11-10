import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableIdeas } from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { Accessor } from 'solid-js';

/**
 * Whether the For you page, its sidebar entry and Home's priorities are
 * shown: `enable-ideas` on, and not a touch device, where ideas have no
 * design yet.
 */
export function useIdeasFlag(): Accessor<boolean> {
  const flag = useFeatureFlag(enableIdeas);

  return () => flag().enabled && !isTouchDevice();
}
