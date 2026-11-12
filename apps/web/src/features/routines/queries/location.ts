import {
  type GeofenceFence,
  geofenceDeviceId,
  isGeofenceSupported,
} from '@core/mobile/native-geofence';
import { throwOnErr } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import {
  LOCATION_REPORT_URL,
  scheduledActionClient,
} from '@service-scheduled-action/client';
import type { Fence } from '@service-scheduled-action/generated/schemas';
import { queryOptions } from '@tanstack/solid-query';
import type { GeofenceDeviceSource } from '../primitives/geofence-sync';
import { scheduledActionKeys } from './keys';

/** A routine's place as the phone monitors it, without its name. */
function toGeofence(fence: Fence): GeofenceFence {
  return {
    id: fence.id,
    latitude: fence.place.latitude,
    longitude: fence.place.longitude,
    radiusMeters: fence.place.radius_meters,
    on: fence.on,
  };
}

async function fetchGeofences(): Promise<GeofenceFence[]> {
  const list = await throwOnErr(
    async () => await scheduledActionClient.listLocationFences()
  );
  return list.fences.map(toGeofence);
}

/**
 * The places the user's enabled routines watch. Refetched when the app returns
 * to the foreground and whenever a routine changes (`invalidateSchedules`).
 */
export function locationFencesQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: scheduledActionKeys.locationFences.queryKey,
    queryFn: fetchGeofences,
    enabled,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  });
}

/** Mints this phone's report token on the server; the token is returned only here. */
export const GEOFENCE_DEVICE_SOURCE: GeofenceDeviceSource = {
  register: async () => {
    const device = await throwOnErr(
      async () => await scheduledActionClient.registerLocationDevice()
    );
    return {
      deviceId: device.device_id,
      token: device.token,
      reportUrl: LOCATION_REPORT_URL,
    };
  },
};

/**
 * Revokes this phone's report token at sign-out, while the session can still
 * authenticate the request. Best effort: signing out never waits on it failing.
 */
export async function removeRoutineGeofenceDevice(): Promise<void> {
  if (!isGeofenceSupported()) return;
  await Telemetry.span('routines.geofence.remove_device', async (span) => {
    const deviceId = await geofenceDeviceId();
    span.setAttr('routines.geofence.device_registered', deviceId !== null);
    if (!deviceId) return;
    const result = await scheduledActionClient.removeLocationDevice({
      deviceId,
    });
    if (result.isErr()) span.error(result.error);
  });
}
