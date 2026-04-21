import { toast } from '@core/component/Toast/Toast';
import { useTauri } from '@macro/tauri';
import { invoke } from '@tauri-apps/api/core';
import { Show, createEffect, createMemo } from 'solid-js';

export function BundleUpdateProgressBar() {
  const tauri = useTauri();

  const progress = createMemo(() => {
    const status = tauri?.bundleUpdateStatus();
    if (!status) return null;
    switch (status.status) {
      case 'Downloading':
        return status.data.progress;
      case 'Unzipping':
        return status.data.progress;
      default:
        return null;
    }
  });

  createEffect(() => {
    if (tauri?.bundleUpdateStatus().status === 'Completed') {
      toast.success('Update downloaded', 'Tap to apply update', [
        { label: 'Update', onClick: () => invoke('perform_update') },
      ]);
    }
  });

  return (
    <Show when={progress() !== null}>
      <div class="w-full h-0.5 bg-surface-2">
        <div
          class="h-full bg-accent transition-[width] duration-200 ease-linear"
          style={{ width: `${progress()}%` }}
        />
      </div>
    </Show>
  );
}
