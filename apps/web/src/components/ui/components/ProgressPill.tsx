import { Badge, type BadgeSize } from './Badge';

const RING_RADIUS = 6;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
/** Arc length a spinning ring shows when progress can't be measured. */
const INDETERMINATE_ARC = 0.25;

export type ProgressRingProps = {
  /** A completed fraction, or null when progress is indeterminate. */
  fraction: number | null;
};

/** Decorative ring; place it inside an element that names the progress. */
export function ProgressRing(props: ProgressRingProps) {
  const fraction = () => {
    if (props.fraction === null) return INDETERMINATE_ARC;
    if (!Number.isFinite(props.fraction)) return 0;
    return Math.max(0, Math.min(1, props.fraction));
  };

  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      class={`size-4 shrink-0 ${props.fraction === null ? 'motion-safe:animate-spin' : ''}`}
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
        stroke-dashoffset={RING_CIRCUMFERENCE * (1 - fraction())}
        opacity={fraction() === 0 ? 0 : 1}
        transform="rotate(-90 8 8)"
        class="stroke-accent motion-safe:transition-[stroke-dashoffset] motion-safe:duration-150 motion-safe:ease-linear"
      />
    </svg>
  );
}

export type ProgressPillProps = {
  value: number;
  max: number;
  /** Accessible name for the progress, for example "Tasks completed". */
  label: string;
  class?: string;
  size?: BadgeSize;
};

/** Non-interactive completed/total property with a clockwise progress ring.
 *
 * @do Name the tracked work with `label`; the ring is decorative.
 * @dont Do not use this pill as an action or for indeterminate progress.
 */
export function ProgressPill(props: ProgressPillProps) {
  const total = () => (Number.isFinite(props.max) ? Math.max(0, props.max) : 0);
  const completed = () =>
    Number.isFinite(props.value)
      ? Math.max(0, Math.min(total(), props.value))
      : 0;

  return (
    <Badge
      variant="outline"
      size={props.size ?? 'xs'}
      class={props.class}
      role="progressbar"
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={total()}
      aria-valuenow={completed()}
    >
      <ProgressRing fraction={total() > 0 ? completed() / total() : 0} />
      <span class="tabular-nums">
        {props.value}/{props.max}
      </span>
    </Badge>
  );
}
