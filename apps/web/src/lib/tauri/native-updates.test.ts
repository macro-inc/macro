import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  listeners: new Map<string, () => void>(),
  reports: [] as unknown[][],
  invoke: vi.fn(),
  report: vi.fn(),
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
vi.mock('@core/component/Toast/Toast', () => ({ toast: {} }));

import { createNativeUpdates } from './native-updates';

afterEach(() => {
  native.listeners.clear();
  native.reports.length = 0;
  vi.clearAllMocks();
});

native.invoke.mockImplementation(async (command: string) => {
  if (command === 'take_native_update_reports')
    return native.reports.shift() ?? [];
  if (command === 'get_native_update_status') return { status: 'Idle' };
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
  native.invoke.mockImplementationOnce(async () => {
    throw new Error('command take_native_update_reports not found');
  });
  const dispose = createRoot((dispose) => {
    createNativeUpdates(async () => {});
    return dispose;
  });
  await vi.waitFor(() =>
    expect(native.invoke).toHaveBeenCalledWith('take_native_update_reports')
  );
  expect(native.report).not.toHaveBeenCalled();
  dispose();
});
