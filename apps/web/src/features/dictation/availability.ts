import { enableDictation, isFeatureEnabled } from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';

/**
 * Touch keyboards already dictate, so the composer microphone only adds a
 * target to miss next to Send. Off here means no button and no recorder: the
 * controller reports `unavailable`, so nothing can start a session either.
 */
export function isDictationAvailable(): boolean {
  return isFeatureEnabled(enableDictation) && !isTouchDevice();
}
