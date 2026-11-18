import { ProgressRing, Surface } from '@ui';
import { Show } from 'solid-js';
import { uploadProgress } from './uploadProgress';

/** Compact, non-dismissable indicator for every upload in flight. */
export function UploadProgressIndicator() {
  return (
    <Show when={uploadProgress()}>
      {(progress) => {
        const percent = () => {
          const fraction = progress().fraction;
          return fraction === null ? undefined : Math.round(fraction * 100);
        };
        return (
          <Surface
            hideBorder
            role="progressbar"
            aria-label={progress().label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent()}
            class="pointer-events-auto flex size-auto max-w-xs items-center gap-2 rounded-full glass bg-toast px-3 py-1.5 text-sm text-ink"
          >
            <ProgressRing fraction={progress().fraction} />
            <span class="min-w-0 truncate font-medium">{progress().label}</span>
            <Show when={percent() !== undefined}>
              <span class="shrink-0 tabular-nums text-ink-muted">
                {percent()}%
              </span>
            </Show>
          </Surface>
        );
      }}
    </Show>
  );
}
