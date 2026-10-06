import CheckIcon from '@phosphor/check.svg?component-solid';
import { cn } from '@ui';
import { Show } from 'solid-js';

export function SendAsGroupToggle(props: {
  on: boolean;
  locked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label
      class={cn(
        'flex items-start gap-2',
        props.locked ? 'cursor-not-allowed' : 'cursor-default'
      )}
    >
      <div class="relative mt-0.5">
        <input
          onChange={(event) => props.onChange(event.currentTarget.checked)}
          checked={props.on}
          disabled={props.locked}
          class="peer sr-only"
          type="checkbox"
        />
        <div
          class={cn(
            'size-4 border',
            props.locked
              ? 'border-edge peer-checked:bg-surface/20'
              : 'border-edge hover:border-accent/30 peer-checked:bg-accent/10 peer-checked:border-accent/30'
          )}
        >
          <Show when={props.on}>
            <CheckIcon class="size-full text-accent p-0.5" />
          </Show>
        </div>
      </div>
      <div
        class={cn(
          'flex flex-col text-sm',
          props.locked && 'text-ink-disabled/50'
        )}
      >
        <span class="font-medium">Send As Group Message</span>
        <span
          class={cn(
            'text-xs mt-0.5',
            props.locked ? 'text-ink-disabled/50' : 'text-ink-muted'
          )}
        >
          {props.on
            ? 'Creates a new group message with all recipients'
            : 'Send a message to each recipient'}
        </span>
      </div>
    </label>
  );
}
