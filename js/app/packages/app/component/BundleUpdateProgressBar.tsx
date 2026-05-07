import { useTauri } from '@macro/tauri';
import { createMemo, Show } from 'solid-js';

export function BundleUpdateProgressBar() {
  const tauri = useTauri();

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
