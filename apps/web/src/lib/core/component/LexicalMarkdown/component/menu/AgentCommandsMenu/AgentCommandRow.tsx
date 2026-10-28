import { cn } from '@ui';
import { createEffect, Show } from 'solid-js';
import type { AgentCommandItem } from '../../../plugins/agent-commands';

export function AgentCommandRow(props: {
  command: AgentCommandItem;
  index: number;
  selected: boolean;
  itemAction: () => void;
  setIndex: (index: number) => void;
}) {
  let itemRef: HTMLDivElement | undefined;

  createEffect(() => {
    if (props.selected && itemRef) {
      itemRef.scrollIntoView({ block: 'nearest' });
    }
  });

  return (
    <div
      ref={itemRef}
      on:mouseup={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      on:mousedown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      on:click={(e) => {
        props.itemAction();
        e.stopPropagation();
      }}
      on:mousemove={() => props.setIndex(props.index)}
      class={cn('group flex items-baseline gap-2 p-1.5 mx-1.5 rounded-md', {
        'bg-ink/5': props.selected,
      })}
    >
      <span class="shrink-0 text-ink text-xs sm:text-sm font-medium">
        /{props.command.name}
      </span>
      <Show when={props.command.inputHint}>
        <span class="shrink-0 text-xs text-ink-extra-muted">
          {props.command.inputHint}
        </span>
      </Show>
      <span
        class="min-w-0 truncate text-xs text-ink-muted"
        title={props.command.description}
      >
        {props.command.description}
      </span>
    </div>
  );
}
