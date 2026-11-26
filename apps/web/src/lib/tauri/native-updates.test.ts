import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  listeners: new Map<string, () => void>(),
  reports: [] as unknown[][],
  invoke: vi.fn(),
  report: vi.fn(),
  telemetryError: vi.fn(),
  stage: vi.fn(async () => 'staged'),
  calls: [] as string[],
  held: false,
  toastFailure: vi.fn(),
}));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: { error: native.telemetryError },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (event: string, handler: () => void) => {
    native.listeners.set(event, handler);
    return () => Promise.resolve();
  }),
}));
vi.mock('@core/util/platform', () => ({
  isPlatform: (platform: string) => platform === 'desktop',
}));
vi.mock('@app/observability/native-update', () => ({
  reportNativeUpdate: native.report,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: native.toastFailure },
}));
vi.mock('./stage-bundle', () => ({ stageDeployedBundle: native.stage }));
vi.mock('@core/util/reloadForNewerBuild', () => ({
  hasAutomaticReloadHolds: () => native.held,
}));

import { createNativeUpdates } from './native-updates';

afterEach(() => {
  native.listeners.clear();
  native.calls.length = 0;
  native.held = false;
  native.reports.length = 0;
  vi.clearAllMocks();
});

/** Makes the next take fail the way a binary without the command does. */
const missingCommand: unknown[] = [];
/** Makes the next take fail for another reason. */
const brokenTransport: unknown[] = [];

native.invoke.mockImplementation(async (command: string) => {
  if (command === 'take_native_update_reports') {
    const next = native.reports.shift() ?? [];
    // Tauri rejects with the bare message.
    if (next === missingCommand)
      throw 'Command take_native_update_reports not found';
    if (next === brokenTransport) throw 'IPC transport closed';
    return next;
  }
  native.calls.push(command);
  if (command === 'get_native_update_status')
    return native.calls.includes('ready')
      ? { status: 'Ready', data: { version: '2026.1124.0' } }
      : { status: 'Idle' };
  if (command === 'restart_native_update') return;
  throw new Error(`unexpected ${command}`);
});

it('sends reports waiting at mount and each batch the host announces', async () => {
  native.reports.push([{ id: 'install' }], [{ id: 'check' }]);
  const dispose = createRoot((dispose) => {
    createNativeUpdates(async () => {});
    return dispose;
  });
  await vi.waitFor(() => expect(native.report).toHaveBeenCalledTimes(1));
  expect(native.report).toHaveBeenCalledWith({ id: 'install' });

  native.listeners.get('native-update-report')?.();
  await vi.waitFor(() => expect(native.report).toHaveBeenCalledTimes(2));
  expect(native.report).toHaveBeenLastCalledWith({ id: 'check' });
  dispose();
});

it('stays quiet on binaries without update reports', async () => {
  native.reports.push(missingCommand);
  const dispose = createRoot((dispose) => {
    createNativeUpdates(async () => {});
    return dispose;
  });
  await vi.waitFor(() =>
    expect(native.invoke).toHaveBeenCalledWith('take_native_update_reports')
  );
  await Promise.resolve();
  // Caught in the drain: fireAndForget would report an escaped rejection.
  expect(native.telemetryError).not.toHaveBeenCalled();
  expect(native.report).not.toHaveBeenCalled();
  dispose();
});

it('records relay failures other than a missing command', async () => {
  native.reports.push(brokenTransport);
  const dispose = createRoot((dispose) => {
    createNativeUpdates(async () => {});
    return dispose;
  });
  await vi.waitFor(() =>
    expect(native.telemetryError).toHaveBeenCalledWith('IPC transport closed', {
      surface: 'native-updates',
    })
  );
  dispose();
});

it('keeps sending a batch after one report fails', async () => {
  native.reports.push([{ id: 'bad' }, { id: 'good' }]);
  native.report.mockImplementationOnce(() => {
    throw new Error('unknown outcome');
  });
  const dispose = createRoot((dispose) => {
    createNativeUpdates(async () => {});
    return dispose;
  });
  await vi.waitFor(() =>
    expect(native.report).toHaveBeenCalledWith({ id: 'good' })
  );
  expect(native.telemetryError).toHaveBeenCalledOnce();
  dispose();
});

it('stages the deployed web bundle before installing the app update', async () => {
  native.calls.push('ready');
  let finishStaging: (outcome: string) => void = () => {};
  native.stage.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishStaging = resolve;
      })
  );
  const { updates, dispose } = createRoot((dispose) => ({
    updates: createNativeUpdates(async () => {}),
    dispose,
  }));
  await vi.waitFor(() => expect(updates.status().status).toBe('Ready'));

  const restarting = updates.restart();
  await vi.waitFor(() => expect(native.stage).toHaveBeenCalledOnce());
  await Promise.resolve();
  expect(native.calls).not.toContain('restart_native_update');

  finishStaging('staged');
  await restarting;
  expect(native.calls).toContain('restart_native_update');
  dispose();
});

it('neither stages nor restarts while a call or upload blocks the restart', async () => {
  native.calls.push('ready');
  native.held = true;
  const { updates, dispose } = createRoot((dispose) => ({
    updates: createNativeUpdates(async () => {}),
    dispose,
  }));
  await vi.waitFor(() => expect(updates.status().status).toBe('Ready'));

  await updates.restart();

  expect(native.stage).not.toHaveBeenCalled();
  expect(native.calls).not.toContain('restart_native_update');
  expect(native.toastFailure).toHaveBeenCalledOnce();
  dispose();
});

it('does not restart when a call starts while the bundle downloads', async () => {
  native.calls.push('ready');
  native.stage.mockImplementationOnce(async () => {
    native.held = true;
    return 'staged';
  });
  const { updates, dispose } = createRoot((dispose) => ({
    updates: createNativeUpdates(async () => {}),
    dispose,
  }));
  await vi.waitFor(() => expect(updates.status().status).toBe('Ready'));

  await updates.restart();

  expect(native.calls).not.toContain('restart_native_update');
  expect(native.toastFailure).toHaveBeenCalledOnce();
  dispose();
});
