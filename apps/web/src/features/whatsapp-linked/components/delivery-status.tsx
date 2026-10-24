import CheckIcon from '@phosphor/check.svg';
import ChecksIcon from '@phosphor/checks.svg';
import ClockIcon from '@phosphor/clock.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import WarningIcon from '@phosphor/warning-circle.svg';
import { Button, cn, Tooltip } from '@ui';
import { Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  type DeliveryState,
  deliveryPresentation,
  needsAttention,
} from '../core/delivery';

const icons = {
  clock: ClockIcon,
  spinner: SpinnerIcon,
  check: CheckIcon,
  checks: ChecksIcon,
  warning: WarningIcon,
};

/**
 * One send's delivery under its message. Quiet states are a small icon line;
 * failed and unconfirmed sends explain themselves and offer recovery.
 */
export function DeliveryStatus(props: {
  state: DeliveryState;
  errorCode?: string | null;
  onRecover?: () => void;
}) {
  const status = () => deliveryPresentation(props.state, props.errorCode);
  const attention = () => needsAttention(props.state);
  return (
    <div
      class="mt-1 flex flex-col items-start gap-1"
      data-linked-delivery={props.state}
    >
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Tooltip label={status().detail} as="span">
          <span
            class={cn(
              'inline-flex items-center gap-1 text-xs',
              status().tone === 'error' ? 'text-failure-ink' : 'text-ink-muted'
            )}
            role="status"
            tabIndex={0}
          >
            <Dynamic
              component={icons[status().icon]}
              class={cn(
                'size-3 shrink-0',
                props.state === 'sending' && 'animate-spin'
              )}
              aria-hidden="true"
            />
            {status().label}
          </span>
        </Tooltip>
        <Show when={attention() && props.onRecover}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              props.onRecover?.();
            }}
          >
            {props.state === 'unknown' ? 'Review message' : 'Edit and retry'}
          </Button>
        </Show>
      </div>
      <Show when={attention()}>
        <p class="max-w-prose text-xs leading-relaxed text-ink-muted">
          {status().detail}
        </p>
      </Show>
    </div>
  );
}
