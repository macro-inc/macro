import WarningCircleIcon from '@icon/system/regular/warning-circle.svg';
import { cn } from '@ui';
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';

/**
 * A bordered notice for something the computer flow cannot get past: a
 * warning icon, the message as the alert, then the caller's remedy beside it
 * (wrapping below on a narrow sheet) and anything it holds back below.
 */
export function FailureNotice(props: {
  children: JSX.Element;
  /** The remedy, at the end of the message's line. */
  actions?: JSX.Element;
  /** Below the message, aligned with it: details a disclosure reveals. */
  below?: JSX.Element;
  class?: string;
}) {
  return (
    <div
      class={cn(
        'flex items-start gap-3 rounded-lg border border-edge-muted p-4',
        props.class
      )}
    >
      <WarningCircleIcon
        aria-hidden="true"
        class="mt-0.5 size-4 shrink-0 text-failure"
      />
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p role="alert" class="min-w-0 flex-1 text-sm text-ink text-pretty">
            {props.children}
          </p>
          <Show when={props.actions}>
            <div class="flex shrink-0 items-center gap-1">{props.actions}</div>
          </Show>
        </div>
        {props.below}
      </div>
    </div>
  );
}
