import { cn } from '@ui';
import { type JSX, Show } from 'solid-js';

/** Only the persistent action adds width; quick actions reuse the date's space. */
export function RowEnd(props: {
  actions?: JSX.Element;
  leadingAction?: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <div class="flex items-center justify-end gap-1">
      {props.leadingAction}
      <div class="grid items-center justify-items-end">
        <div
          class={cn(
            '[grid-area:1/1]',
            props.actions &&
              'group-hover/entity:invisible group-focus-within/entity:invisible'
          )}
        >
          {props.children}
        </div>
        <Show when={props.actions}>
          <div class="[grid-area:1/1] opacity-0 pointer-events-none group-hover/entity:opacity-100 group-hover/entity:pointer-events-auto group-focus-within/entity:opacity-100 group-focus-within/entity:pointer-events-auto">
            {props.actions}
          </div>
        </Show>
      </div>
    </div>
  );
}
