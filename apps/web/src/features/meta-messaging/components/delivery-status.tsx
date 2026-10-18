import CheckIcon from '@phosphor/check.svg';
import ChecksIcon from '@phosphor/checks.svg';
import ClockIcon from '@phosphor/clock.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import WarningIcon from '@phosphor/warning-circle.svg';
import { Button, cn, Tooltip } from '@ui';
import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  type DeliveryState,
  deliveryPresentation,
  type MessagingProvider,
} from '../core/delivery';

const icons = {
  clock: ClockIcon,
  spinner: SpinnerIcon,
  check: CheckIcon,
  checks: ChecksIcon,
  warning: WarningIcon,
};

export function DeliveryStatus(props: {
  state: DeliveryState;
  provider: MessagingProvider;
  error?: string | null;
  createdAt?: string;
  onRecover?: () => void;
}) {
  const [delayed, setDelayed] = createSignal(false);
  const pending = () => props.state === 'pending' || props.state === 'sending';
  createEffect(() => {
    setDelayed(false);
    if (!pending()) return;
    const created = Date.parse(props.createdAt ?? '');
    const remaining = Number.isFinite(created)
      ? Math.max(0, 5_000 - (Date.now() - created))
      : 5_000;
    if (remaining === 0) {
      setDelayed(true);
      return;
    }
    const timer = setTimeout(() => setDelayed(true), remaining);
    onCleanup(() => clearTimeout(timer));
  });
  const status = () =>
    deliveryPresentation(props.state, props.provider, props.error);
  const attention = () =>
    status().tone === 'error' || status().tone === 'uncertain';
  return (
    <Show when={attention() || (pending() && delayed())}>
      <div
        class="mt-1 flex flex-col items-start gap-1"
        data-external-delivery={props.state}
      >
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Tooltip label={status().detail ?? status().label} as="span">
            <span
              class={cn(
                'inline-flex items-center gap-1 text-xs',
                status().tone === 'error'
                  ? 'text-failure-ink'
                  : 'text-ink-muted'
              )}
              role="status"
              aria-label={pending() ? 'Still sending…' : status().label}
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
              {pending() ? 'Still sending…' : status().label}
            </span>
          </Tooltip>
          <Show when={attention() && props.onRecover}>
            <Button
              variant="ghost"
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                props.onRecover?.();
              }}
            >
              {props.state === 'unknown' ? 'Review reply' : 'Edit and retry'}
            </Button>
          </Show>
        </div>
        <Show when={attention()}>
          <p class="max-w-prose text-xs text-ink-muted leading-relaxed">
            {status().detail}
          </p>
        </Show>
      </div>
    </Show>
  );
}
