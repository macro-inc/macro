import { isPlatform } from '@core/util/platform';
import { invoke } from '@tauri-apps/api/core';

let cached: Promise<boolean> | undefined;

/**
 * Whether we're running in the native iOS app on an iPad.
 *
 * `getPlatform()` reports `'ios'` for iPhone and iPad alike, so this asks the
 * native side for `UIDevice.current.userInterfaceIdiom`. iOS apps running on an
 * Apple Silicon Mac report the iPad idiom too, and are excluded natively.
 *
 * The idiom can't change at runtime, so the result is cached.
 */
export function isIpad(): Promise<boolean> {
  if (!isPlatform('ios')) return Promise.resolve(false);
  cached ??= invoke<boolean>('is_ipad').catch((error) => {
    // Most likely the native side predates the `is_ipad` command — warn rather
    // than fail silently, since "not an iPad" is indistinguishable from a
    // stale binary otherwise.
    console.warn('is_ipad command unavailable; assuming non-iPad', error);
    return false;
  });
  return cached;
}
