import { cn } from '@ui';
import { type JSX, Show } from 'solid-js';

/** Quick actions replace the date without retaining its width on hover or focus. */
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
              'group-hover/entity:hidden group-focus-within/entity:hidden'
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
