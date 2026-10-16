import { cn, Surface } from '@ui';
import { Show } from 'solid-js';
import { uploadProgress } from './uploadProgress';

const RING_RADIUS = 6;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
/** Arc length a spinning ring shows when progress can't be measured. */
const INDETERMINATE_ARC = 0.25;

function ProgressRing(props: { fraction: number | null }) {
  const offset = () =>
    RING_CIRCUMFERENCE * (1 - (props.fraction ?? INDETERMINATE_ARC));

  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      class={cn('size-4 shrink-0', props.fraction === null && 'animate-spin')}
    >
      <circle
        cx="8"
        cy="8"
        r={RING_RADIUS}
        fill="none"
        stroke-width="2"
        class="stroke-ink/15"
      />
      <circle
        cx="8"
        cy="8"
        r={RING_RADIUS}
        fill="none"
        stroke-width="2"
        stroke-linecap="round"
        stroke-dasharray={String(RING_CIRCUMFERENCE)}
        stroke-dashoffset={offset()}
        transform="rotate(-90 8 8)"
        class="stroke-accent transition-[stroke-dashoffset] duration-150 ease-linear"
      />
    </svg>
  );
}

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
