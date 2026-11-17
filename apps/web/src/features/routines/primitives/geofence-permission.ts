import {
  type GeofencePermission,
  geofenceStatus,
  requestGeofencePermission,
} from '@core/mobile/native-geofence';
import { fireAndForget } from '@core/util/fireAndForget';
import { createSignal, onCleanup, onMount } from 'solid-js';

/**
 * This phone's location access for place triggers, re-read when the app comes
 * back to the foreground, since it is changed in the system's Settings. Only
 * where `isGeofenceSupported()`.
 */
export function createGeofencePermission() {
  const [permission, setPermission] = createSignal<GeofencePermission>();
  const [requesting, setRequesting] = createSignal(false);

  async function refresh() {
    setPermission((await geofenceStatus()).permission);
  }

  function refreshWhenVisible() {
    if (document.visibilityState === 'visible')
      fireAndForget(refresh(), 'routines-geofence');
  }

  onMount(() => {
    fireAndForget(refresh(), 'routines-geofence');
    document.addEventListener('visibilitychange', refreshWhenVisible);
  });
  onCleanup(() =>
    document.removeEventListener('visibilitychange', refreshWhenVisible)
  );

  async function request() {
    setRequesting(true);
    try {
      setPermission(await requestGeofencePermission());
    } finally {
      setRequesting(false);
    }
  }

  return { permission, requesting, request };
}
