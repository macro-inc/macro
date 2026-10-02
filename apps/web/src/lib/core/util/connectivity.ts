import { nativeNetworkStatus } from '@core/mobile/native-network-status';
import { type Accessor, createSignal, onCleanup } from 'solid-js';

/**
 * Best-effort "definitely offline" check across platforms: the native
 * network monitor on iOS, `navigator.onLine` elsewhere. Either may lag
 * reality — a false negative just means the guarded action attempts and
 * surfaces its own failure.
 */
export function deviceLooksOffline(): boolean {
  const native = nativeNetworkStatus();
  if (native !== 'unknown') return native === 'offline';
  // navigator.onLine decides only when the native monitor has no answer: it
  // reports false during native cold launches while the network is fine
  // (see useUserInfoQuery's networkMode), so it must not override an
  // 'online' native reading.
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** `navigator.onLine` as a signal, following the browser's connectivity events. */
export function createBrowserOfflineSignal(): Accessor<boolean> {
  const [offline, setOffline] = createSignal(
    typeof navigator !== 'undefined' && !navigator.onLine
  );
  if (typeof window !== 'undefined') {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    onCleanup(() => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    });
  }
  return offline;
}
