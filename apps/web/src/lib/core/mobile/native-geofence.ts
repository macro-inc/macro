import { isPlatform } from '@core/util/platform';
import { invoke } from '@tauri-apps/api/core';

declare global {
  interface Window {
    /** Advertised by native binaries that register the geofence plugin. */
    __MACRO_GEOFENCE__?: boolean;
  }
}

/** Location permission for monitoring places; only `always` reports crossings while the app is closed. */
export type GeofencePermission =
  | 'unsupported'
  | 'not_determined'
  | 'denied'
  | 'when_in_use'
  | 'always';

/** A routine's place, as the native plugin monitors it. */
export type GeofenceFence = {
  /** Opaque fence id from `GET /scheduled-actions/location/fences`. */
  id: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  /** The one crossing this fence reports. */
  on: 'arrive' | 'leave';
};

export type GeofenceStatus = {
  permission: GeofencePermission;
  /** Whether a device token is stored natively. */
  device: boolean;
};

/** Credentials from `POST /scheduled-actions/location/devices`, plus the absolute report URL. */
export type GeofenceDevice = {
  deviceId: string;
  token: string;
  reportUrl: string;
};

type NativeStatus = { permission: unknown; device: unknown };

const GEOFENCE_PERMISSIONS: readonly GeofencePermission[] = [
  'unsupported',
  'not_determined',
  'denied',
  'when_in_use',
  'always',
];

const UNSUPPORTED_MESSAGE = 'Geofencing is not available on this device';

/**
 * Whether this binary monitors places: native iOS and Android builds that
 * include the plugin. Over-the-air web bundles also run in older binaries.
 */
export function isGeofenceSupported(): boolean {
  return isPlatform(['ios', 'android']) && window.__MACRO_GEOFENCE__ === true;
}

/** Native payloads come from a separately shipped binary; read unknown values as unsupported. */
function parsePermission(value: unknown): GeofencePermission {
  return (
    GEOFENCE_PERMISSIONS.find((permission) => permission === value) ??
    'unsupported'
  );
}

export async function geofenceStatus(): Promise<GeofenceStatus> {
  if (!isGeofenceSupported()) {
    return { permission: 'unsupported', device: false };
  }

  const status = await invoke<NativeStatus>('plugin:geofence|status');
  return {
    permission: parsePermission(status.permission),
    device: status.device === true,
  };
}

/** Asks for "Always" location access and resolves with the resulting permission. */
export async function requestGeofencePermission(): Promise<GeofencePermission> {
  if (!isGeofenceSupported()) return 'unsupported';

  const result = await invoke<{ permission: unknown }>(
    'plugin:geofence|request_permission'
  );
  return parsePermission(result.permission);
}

/** Stores the device token natively, where crossings are reported from. */
export async function setGeofenceDevice(device: GeofenceDevice): Promise<void> {
  if (!isGeofenceSupported()) throw new Error(UNSUPPORTED_MESSAGE);

  await invoke<void>('plugin:geofence|set_device', device);
}

export async function geofenceDeviceId(): Promise<string | null> {
  if (!isGeofenceSupported()) return null;

  const result = await invoke<{ deviceId: unknown }>(
    'plugin:geofence|device_id'
  );
  return typeof result.deviceId === 'string' ? result.deviceId : null;
}

/** Replaces the monitored places. */
export async function syncGeofences(fences: GeofenceFence[]): Promise<void> {
  if (!isGeofenceSupported()) throw new Error(UNSUPPORTED_MESSAGE);

  await invoke<void>('plugin:geofence|sync', { fences });
}

/** Stops monitoring and forgets the device token (sign-out). Nothing is stored where unsupported. */
export async function clearGeofences(): Promise<void> {
  if (!isGeofenceSupported()) return;

  await invoke<void>('plugin:geofence|clear');
}
