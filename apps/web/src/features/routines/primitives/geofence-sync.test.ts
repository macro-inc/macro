import type {
  GeofenceFence,
  GeofencePermission,
} from '@core/mobile/native-geofence';
import { NOOP_SPAN } from '@macro-inc/observability';
import { describe, expect, it, vi } from 'vitest';
import {
  createGeofenceSyncQueue,
  type GeofencePhone,
  syncRoutineGeofences,
} from './geofence-sync';

const OFFICE: GeofenceFence = {
  id: 'fence-office',
  latitude: 40.7128,
  longitude: -74.006,
  radiusMeters: 200,
  on: 'arrive',
};

function fakePhone(state: {
  deviceId: string | null;
  permission: GeofencePermission;
}) {
  const calls: string[] = [];
  const phone: GeofencePhone = {
    deviceId: async () => state.deviceId,
    setDevice: async (device) => {
      calls.push(`setDevice ${device.deviceId} ${device.reportUrl}`);
      state.deviceId = device.deviceId;
    },
    monitor: async (fences) => {
      calls.push(`monitor ${fences.map((fence) => fence.id).join(',')}`);
    },
    permission: async () => {
      calls.push('permission');
      return state.permission;
    },
  };
  return { phone, calls };
}

const devices = {
  register: async () => ({
    deviceId: 'device-1',
    token: 'secret',
    reportUrl: 'https://gateway.example/scheduled-actions/location/reports',
  }),
};

describe('syncing routine places to the phone', () => {
  it('registers the phone once the user has a place, without asking for access', async () => {
    const { phone, calls } = fakePhone({
      deviceId: null,
      permission: 'not_determined',
    });
    await syncRoutineGeofences([OFFICE], { devices, phone }, NOOP_SPAN);
    expect(calls).toEqual([
      'setDevice device-1 https://gateway.example/scheduled-actions/location/reports',
      'monitor fence-office',
      'permission',
    ]);
  });

  it('keeps a registered phone', async () => {
    const { phone, calls } = fakePhone({
      deviceId: 'device-1',
      permission: 'when_in_use',
    });
    await syncRoutineGeofences([OFFICE], { devices, phone }, NOOP_SPAN);
    expect(calls).toEqual(['monitor fence-office', 'permission']);
  });

  it('mints no token and asks nothing of a user without places', async () => {
    const { phone, calls } = fakePhone({
      deviceId: null,
      permission: 'not_determined',
    });
    await syncRoutineGeofences([], { devices, phone }, NOOP_SPAN);
    // An empty set still stops watching places a deleted routine named.
    expect(calls).toEqual(['monitor ']);
  });
});

describe('the sync queue', () => {
  it('runs one sync at a time and only the latest of those asked for meanwhile', async () => {
    const started: string[][] = [];
    let finishFirst: () => void = () => {};
    const run = vi.fn(async (fences: GeofenceFence[]) => {
      started.push(fences.map((fence) => fence.id));
      if (started.length === 1)
        await new Promise<void>((resolve) => {
          finishFirst = resolve;
        });
    });
    const sync = createGeofenceSyncQueue(run, () => {});

    const first = sync([OFFICE]);
    const second = sync([]);
    const third = sync([{ ...OFFICE, id: 'fence-home' }]);
    await Promise.all([second, third]);
    expect(started).toEqual([['fence-office']]);

    finishFirst();
    await first;
    expect(started).toEqual([['fence-office'], ['fence-home']]);
  });

  it('reports a failed sync and keeps going', async () => {
    const errors: unknown[] = [];
    const failure = new Error('native sync failed');
    const sync = createGeofenceSyncQueue(
      async (fences) => {
        if (fences.length) throw failure;
      },
      (error) => errors.push(error)
    );
    await sync([OFFICE]);
    await sync([]);
    expect(errors).toEqual([failure]);
  });
});
