import type { NativeUpdateStatus } from '@app/lib/tauri/native-updates';
import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({
  status: (() => ({
    status: 'Idle',
    failedInstallVersion: null,
  })) as () => NativeUpdateStatus,
  restart: vi.fn(async () => {}),
}));
vi.mock('@macro/tauri', async () => ({
  retryingFailedInstall: (await import('@app/lib/tauri/native-updates'))
    .retryingFailedInstall,
  useTauri: () => ({
    nativeUpdateStatus: () => tauri.status(),
    nativeUpdatePreparing: () => false,
    restartNativeUpdate: tauri.restart,
    bundleUpdateStatus: () => ({ status: 'Idle' }),
  }),
}));

import { useAppUpdate } from './app-update';

it('offers to try a failed install again once it has downloaded again', () => {
  const [status, setStatus] = createSignal<NativeUpdateStatus>({
    status: 'Downloading',
    data: { version: '2026.1119.1' },
    failedInstallVersion: '2026.1119.1',
  });
  tauri.status = status;
  createRoot((dispose) => {
    const update = useAppUpdate();
    const downloading = update();
    expect(downloading?.waiting).toBe(true);

    setStatus({
      status: 'Ready',
      data: { version: '2026.1119.1' },
      failedInstallVersion: '2026.1119.1',
    });
    const ready = update();
    expect(ready?.waiting).toBe(false);
    // A new id opens the popover again, now that Try again works.
    expect(ready?.id).not.toBe(downloading?.id);
    ready?.apply();
    expect(tauri.restart).toHaveBeenCalledTimes(1);
    dispose();
  });
});

it('still offers a ready update from a binary that does not report failed installs', () => {
  tauri.restart.mockClear();
  // Older binaries send the status without `failedInstallVersion`.
  tauri.status = () => ({ status: 'Ready', data: { version: '2026.1119.1' } });
  createRoot((dispose) => {
    const update = useAppUpdate()();
    expect(update?.waiting).toBe(false);
    update?.apply();
    expect(tauri.restart).toHaveBeenCalledTimes(1);
    dispose();
  });
});

it('says nothing about a failed install while a check may find nothing to retry', () => {
  // Checks run every few hours and after each failed download.
  tauri.status = () => ({
    status: 'Checking',
    failedInstallVersion: '2026.1119.1',
  });
  createRoot((dispose) => {
    expect(useAppUpdate()()).toBeUndefined();
    dispose();
  });
});
