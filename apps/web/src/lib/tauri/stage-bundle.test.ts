import { afterEach, expect, it, vi } from 'vitest';
import type { BundleUpdateStatus } from './TauriProvider';

const native = vi.hoisted(() => ({
  status: undefined as ((status: BundleUpdateStatus) => void) | undefined,
  registration: undefined as Promise<void> | undefined,
  unlisten: vi.fn(async () => {}),
  invoke: vi.fn(async (_command: string) => {}),
  attrs: {} as Record<string, unknown>,
}));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    error: vi.fn(),
    span: async (
      _name: string,
      operation: (span: {
        setAttr(key: string, value: unknown): void;
      }) => Promise<unknown>
    ) =>
      operation({
        setAttr(key, value) {
          native.attrs[key] = value;
        },
      }),
  },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(
    async (
      _event: string,
      handler: (event: { payload: BundleUpdateStatus }) => void
    ) => {
      native.status = (payload) => handler({ payload });
      await native.registration;
      return native.unlisten;
    }
  ),
}));

import { stageDeployedBundle } from './stage-bundle';

afterEach(() => {
  native.status = undefined;
  native.registration = undefined;
  native.attrs = {};
  vi.clearAllMocks();
  vi.useRealTimers();
});

it('waits for the deployed bundle to finish downloading', async () => {
  const staging = stageDeployedBundle();
  await vi.waitFor(() =>
    expect(native.invoke).toHaveBeenCalledWith('check_for_update')
  );

  native.status?.({ status: 'CheckingForUpdate' });
  native.status?.({ status: 'Downloading', data: { progress: 40 } });
  native.status?.({ status: 'Completed' });

  expect(await staging).toBe('staged');
  expect(native.attrs['native.update.stage_bundle.outcome']).toBe('staged');
  expect(native.unlisten).toHaveBeenCalledOnce();
});

it('restarts at once when the running bundle is the deployed one', async () => {
  const staging = stageDeployedBundle();
  await vi.waitFor(() => expect(native.invoke).toHaveBeenCalled());

  native.status?.({ status: 'NoUpdateNeeded' });

  expect(await staging).toBe('up_to_date');
});

it('gives up on a bundle that needs a newer desktop app', async () => {
  const staging = stageDeployedBundle();
  await vi.waitFor(() => expect(native.invoke).toHaveBeenCalled());

  native.status?.({
    status: 'NativeUpdateRequired',
    data: { bundleBuild: 30, minNativeBuild: 200 },
  });

  expect(await staging).toBe('not_staged');
});

it('stops waiting for a slow download after the timeout', async () => {
  vi.useFakeTimers();
  const staging = stageDeployedBundle(10_000);
  await vi.waitFor(() => expect(native.invoke).toHaveBeenCalled());
  native.status?.({ status: 'Downloading', data: { progress: 10 } });

  await vi.advanceTimersByTimeAsync(10_000);

  expect(await staging).toBe('timed_out');
  expect(native.unlisten).toHaveBeenCalledOnce();
});

it('restarts at once when the check cannot start', async () => {
  native.invoke.mockRejectedValueOnce('Failed to send start signal');

  expect(await stageDeployedBundle()).toBe('failed');
});

it('ends at the deadline while the listener registration hangs', async () => {
  vi.useFakeTimers();
  let register: () => void = () => {};
  native.registration = new Promise((resolve) => {
    register = resolve;
  });
  const staging = stageDeployedBundle(10_000);

  await vi.advanceTimersByTimeAsync(10_000);
  expect(await staging).toBe('timed_out');

  // A registration that answers late cleans up and starts no check.
  register();
  await vi.waitFor(() => expect(native.unlisten).toHaveBeenCalledOnce());
  expect(native.invoke).not.toHaveBeenCalled();
});
