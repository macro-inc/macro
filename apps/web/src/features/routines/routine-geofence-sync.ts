import {
  geofenceDeviceId,
  geofenceStatus,
  isGeofenceSupported,
  requestGeofencePermission,
  setGeofenceDevice,
  syncGeofences,
} from '@core/mobile/native-geofence';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import type {
  ActionTrigger,
  ScheduledAction,
} from '@service-scheduled-action/generated/schemas';
import { hashKey, useQuery } from '@tanstack/solid-query';
import { type Accessor, createEffect, on, onCleanup } from 'solid-js';
import {
  createGeofenceSyncQueue,
  type GeofencePhone,
  syncRoutineGeofences,
} from './primitives/geofence-sync';
import { scheduledActionKeys } from './queries/keys';
import {
  GEOFENCE_DEVICE_SOURCE,
  locationFencesQueryOptions,
} from './queries/location';

function triggerPlaces(trigger: ActionTrigger): object[] {
  if (trigger.type === 'location') return [trigger];
  if (trigger.type === 'multiple')
    return trigger.triggers.filter((item) => item.type === 'location');
  return [];
}

/** What of the routine list decides the phone's places. */
function placesSignature(routines: ScheduledAction[] | undefined) {
  return JSON.stringify(
    (routines ?? [])
      .filter((routine) => routine.enabled)
      .map((routine) => [routine.id, triggerPlaces(routine.trigger)])
  );
}

/**
 * Refetches the places when the cached routine list changes them, whoever
 * changed it: this app's editors, another device, or a deletion elsewhere.
 */
function watchRoutinePlaces() {
  const listHash = hashKey(scheduledActionKeys.list.queryKey);
  let signature: string | undefined;
  const stop = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.query.queryHash !== listHash) return;
    const next = placesSignature(
      queryClient.getQueryData<ScheduledAction[]>(
        scheduledActionKeys.list.queryKey
      )
    );
    if (signature !== undefined && next !== signature)
      queryClient.invalidateQueries({
        queryKey: scheduledActionKeys.locationFences.queryKey,
      });
    signature = next;
  });
  onCleanup(stop);
}

/**
 * Keeps the native app watching the places the user's routines name: on
 * start, on return to the foreground, and whenever a routine changes. Mounted
 * once in the signed-in app; does nothing outside the iOS and Android apps.
 */
export function useRoutineGeofenceSync(userId: Accessor<string | undefined>) {
  if (!isGeofenceSupported()) return;
  // Results that arrive after sign-out must not store a token or places.
  const signedIn = () => userId() !== undefined;
  const phone: GeofencePhone = {
    deviceId: geofenceDeviceId,
    setDevice: async (device) => {
      if (signedIn()) await setGeofenceDevice(device);
    },
    monitor: async (fences) => {
      if (signedIn()) await syncGeofences(fences);
    },
    permission: async () => (await geofenceStatus()).permission,
    requestPermission: requestGeofencePermission,
  };
  const sync = createGeofenceSyncQueue(
    (fences) =>
      Telemetry.span('routines.geofence_sync', (span) =>
        syncRoutineGeofences(
          fences,
          { devices: GEOFENCE_DEVICE_SOURCE, phone },
          span
        )
      ),
    (error) => Telemetry.error(error, { surface: 'routines-geofence' })
  );

  const fences = useQuery(() => locationFencesQueryOptions(signedIn()));
  createEffect(
    on(
      () => fences.dataUpdatedAt,
      () => {
        if (!fences.isSuccess) return;
        fireAndForget(sync(fences.data), 'routines-geofence');
      }
    )
  );
  watchRoutinePlaces();
}
