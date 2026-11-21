import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { disableOldHome, enableNewHome } from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { Accessor } from 'solid-js';
import { type NewHomeMode, resolveNewHomeMode } from './core/new-home-mode';

/** Which Homes desktop shows; undefined while the flags that decide it load. */
export function useNewHomeMode(): Accessor<NewHomeMode | undefined> {
  const newHome = useFeatureFlag(enableNewHome);
  const oldHomeOff = useFeatureFlag(disableOldHome);
  return () =>
    resolveNewHomeMode({
      touch: isTouchDevice(),
      enableNewHome: newHome(),
      disableOldHome: oldHomeOff(),
    });
}
