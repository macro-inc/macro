import { nativeNetworkStatus } from '@core/mobile/native-network-status';

/**
 * Best-effort "definitely offline" check across platforms: the native
 * network monitor on iOS, `navigator.onLine` elsewhere. Either may lag
 * reality — a false negative just means the guarded action attempts and
 * surfaces its own failure.
 */
export function deviceLooksOffline(): boolean {
  return (
    nativeNetworkStatus() === 'offline' ||
    (typeof navigator !== 'undefined' && navigator.onLine === false)
  );
}
