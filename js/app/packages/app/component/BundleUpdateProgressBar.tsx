import { toast } from '@core/component/Toast/Toast';
import { useTauri } from '@macro/tauri';
import { invoke } from '@tauri-apps/api/core';
import { Show, createEffect, createMemo, on } from 'solid-js';

export function BundleUpdateProgressBar() {
  const tauri = useTauri();

  const status = createMemo(() => tauri?.bundleUpdateStatus().status);

  const progress = createMemo(() => {
    const s = tauri?.bundleUpdateStatus();
    if (!s) return null;
    switch (s.status) {
      case 'Downloading':
        return s.data.progress * 0.95;
      case 'Unzipping':
        return 95 + s.data.progress * 0.05;
      default:
        return null;
    }
  });

  createEffect(
    on(status, (cur, prev) => {
      if (prev !== 'Completed' && cur === 'Completed') {
        toast.success('Update downloaded', 'Tap to apply update', [
          {
            label: 'Update',
            onClick: () =>
              invoke('perform_update').catch((e) =>
                console.error('[bundle-update] perform_update failed', e)
              ),
          },
        ]);
      }
    })
  );

  return (
    <Show when={progress() !== null}>
      <div class="w-full h-0.5 bg-surface-2">
        <div
          class="h-full bg-accent transition-[width] duration-200 ease-linear"
          style={{ width: `${progress() ?? 0}%` }}
        />
      </div>
    </Show>
  );
}
