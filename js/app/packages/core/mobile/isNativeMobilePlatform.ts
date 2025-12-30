import { getNativeMobilePlatform } from '@core/util/platform';

export function isNativeMobilePlatform() {
  return !!getNativeMobilePlatform();
}
