import {
  getNativeMobilePlatform,
  type NativeMobilePlatform,
} from '@core/util/platform';

export function isNativeMobilePlatform(): NativeMobilePlatform | undefined {
  return getNativeMobilePlatform();
}
