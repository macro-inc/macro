import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  platform: 'android',
}));
vi.mock('@core/util/platform', () => ({
  isPlatform: (platforms: string | string[]) =>
    platforms.includes(mocks.platform),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));

import {
  clearGeofences,
  geofenceDeviceId,
  geofenceStatus,
  requestGeofencePermission,
  setGeofenceDevice,
  syncGeofences,
} from './native-geofence';

afterEach(() => {
  delete window.__MACRO_GEOFENCE__;
  mocks.platform = 'android';
  vi.clearAllMocks();
});

describe('native geofence bridge', () => {
  it('reports unsupported on desktop without calling native code', async () => {
    mocks.platform = 'desktop';
    window.__MACRO_GEOFENCE__ = true;

    expect(await geofenceStatus()).toEqual({
      permission: 'unsupported',
      device: false,
    });
    expect(await requestGeofencePermission()).toBe('unsupported');
    expect(await geofenceDeviceId()).toBeNull();
    await clearGeofences();
    await expect(
      syncGeofences([
        {
          id: 'fence-1',
          latitude: 40.7128,
          longitude: -74.006,
          radiusMeters: 200,
          on: 'arrive',
        },
      ])
    ).rejects.toThrow('Geofencing is not available on this device');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('reports unsupported in an older iOS binary that lacks the plugin', async () => {
    mocks.platform = 'ios';

    expect(await geofenceStatus()).toEqual({
      permission: 'unsupported',
      device: false,
    });
    await expect(
      setGeofenceDevice({
        deviceId: '0190a3c4-0000-7000-8000-000000000001',
        token: 'device-token',
        reportUrl:
          'https://scheduled-action.macro.com/scheduled-actions/location/reports',
      })
    ).rejects.toThrow('Geofencing is not available on this device');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('passes the device and fences to the plugin and reads its answers', async () => {
    window.__MACRO_GEOFENCE__ = true;
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'plugin:geofence|status') {
        return { permission: 'when_in_use', device: true };
      }
      if (command === 'plugin:geofence|request_permission') {
        return { permission: 'always' };
      }
      if (command === 'plugin:geofence|device_id') {
        return { deviceId: '0190a3c4-0000-7000-8000-000000000001' };
      }
      return null;
    });

    expect(await geofenceStatus()).toEqual({
      permission: 'when_in_use',
      device: true,
    });
    expect(await requestGeofencePermission()).toBe('always');
    await setGeofenceDevice({
      deviceId: '0190a3c4-0000-7000-8000-000000000001',
      token: 'device-token',
      reportUrl:
        'https://scheduled-action.macro.com/scheduled-actions/location/reports',
    });
    expect(await geofenceDeviceId()).toBe(
      '0190a3c4-0000-7000-8000-000000000001'
    );
    await syncGeofences([
      {
        id: 'fence-1',
        latitude: 40.7128,
        longitude: -74.006,
        radiusMeters: 200,
        on: 'leave',
      },
    ]);
    await clearGeofences();

    expect(mocks.invoke.mock.calls).toEqual([
      ['plugin:geofence|status'],
      ['plugin:geofence|request_permission'],
      [
        'plugin:geofence|set_device',
        {
          deviceId: '0190a3c4-0000-7000-8000-000000000001',
          token: 'device-token',
          reportUrl:
            'https://scheduled-action.macro.com/scheduled-actions/location/reports',
        },
      ],
      ['plugin:geofence|device_id'],
      [
        'plugin:geofence|sync',
        {
          fences: [
            {
              id: 'fence-1',
              latitude: 40.7128,
              longitude: -74.006,
              radiusMeters: 200,
              on: 'leave',
            },
          ],
        },
      ],
      ['plugin:geofence|clear'],
    ]);
  });

  it('reads a permission a newer binary reports but this bundle does not know as unsupported', async () => {
    window.__MACRO_GEOFENCE__ = true;
    mocks.invoke.mockResolvedValue({ permission: 'precise_only', device: 1 });

    expect(await geofenceStatus()).toEqual({
      permission: 'unsupported',
      device: false,
    });
  });
});
