import type {
  GeofenceDevice,
  GeofenceFence,
  GeofencePermission,
} from '@core/mobile/native-geofence';
import type { Span } from '@macro-inc/observability';

/** Where this phone gets a report token for its owner's places. */
export type GeofenceDeviceSource = {
  register: () => Promise<GeofenceDevice>;
};

/** The phone's geofencing: its stored device, monitored places, and permission. */
export type GeofencePhone = {
  deviceId: () => Promise<string | null>;
  setDevice: (device: GeofenceDevice) => Promise<void>;
  monitor: (fences: GeofenceFence[]) => Promise<void>;
  permission: () => Promise<GeofencePermission>;
};

/**
 * Hands the phone the places to watch. A phone gets a device token only once
 * its owner has a place. The sync never asks for location access: only the
 * Allow button does, so the system prompt comes with its reason.
 */
export async function syncRoutineGeofences(
  fences: GeofenceFence[],
  ports: { devices: GeofenceDeviceSource; phone: GeofencePhone },
  span: Span
): Promise<void> {
  span.setAttr('routines.geofence.fence_count', fences.length);
  const register = fences.length > 0 && (await ports.phone.deviceId()) === null;
  span.setAttr('routines.geofence.device_registered', register);
  if (register) {
    await span.span('routines.geofence.register_device', async () => {
      await ports.phone.setDevice(await ports.devices.register());
    });
  }

  await span.span('routines.geofence.monitor', () =>
    ports.phone.monitor(fences)
  );
  if (fences.length === 0) return;

  span.setAttr('routines.geofence.permission', await ports.phone.permission());
}

/**
 * Runs syncs one at a time. A sync asked for while one runs waits for it, and
 * only the latest of those runs, so overlapping requests never register two
 * devices or leave an older set of places monitored.
 */
export function createGeofenceSyncQueue(
  run: (fences: GeofenceFence[]) => Promise<void>,
  onError: (error: unknown) => void
) {
  let next: GeofenceFence[] | undefined;
  let running = false;
  return async function sync(fences: GeofenceFence[]): Promise<void> {
    next = fences;
    if (running) return;
    running = true;
    while (next) {
      const current = next;
      next = undefined;
      try {
        await run(current);
      } catch (error) {
        onError(error);
      }
    }
    running = false;
  };
}
