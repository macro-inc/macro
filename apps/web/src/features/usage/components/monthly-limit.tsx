import InfoIcon from '@phosphor/info.svg';
import { Button, cn } from '@ui';
import { Show } from 'solid-js';

export function MonthlyLimit(props: {
  percentage: number;
  periodEnd: string;
  unlimited?: boolean;
  onInfo?: () => void;
  infoButtonRef?: (button: HTMLButtonElement) => void;
}) {
  const resetDate = () => {
    const date = new Date(props.periodEnd);
    return Number.isNaN(date.getTime())
      ? undefined
      : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  const percentageLabel = () => `${Math.round(props.percentage)}%`;
  return (
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-1.5">
          <h2 class="text-sm font-medium text-ink">Monthly limit</h2>
          <Show when={props.onInfo}>
            <Button
              ref={props.infoButtonRef}
              size="icon-sm"
              variant="ghost"
              depth={3}
              label="About monthly usage"
              onClick={props.onInfo}
            >
              <InfoIcon class="size-4 text-ink-muted" />
            </Button>
          </Show>
        </div>
        <span class="text-sm font-medium text-ink">
          {props.unlimited ? 'Unlimited' : `${percentageLabel()} used`}
        </span>
      </div>
      <Show when={!props.unlimited}>
        <div
          role="progressbar"
          aria-label="Monthly limit"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={props.percentage}
          aria-valuetext={`${percentageLabel()} used`}
          class="h-2 w-full overflow-hidden rounded-full bg-active"
        >
          <div
            class={cn(
              'h-full rounded-full transition-[width]',
              props.percentage >= 100 ? 'bg-failure' : 'bg-accent'
            )}
            style={{ width: `${props.percentage}%` }}
          />
        </div>
      </Show>
      <Show when={resetDate()}>
        <p class="text-xs text-ink-muted">Resets {resetDate()}</p>
      </Show>
    </div>
  );
}
