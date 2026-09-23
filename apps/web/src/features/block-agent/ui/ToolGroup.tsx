/** Consecutive calls fold to one collapsed row; expand to see the run. */

import { Collapsible } from '@kobalte/core/collapsible';
import CaretRight from '@phosphor/caret-right.svg';
import { createSignal, type JSX, Show } from 'solid-js';
import { TextShimmer } from './TextShimmer';

export interface ToolGroupProps {
  count: number;
  /** A call in the run is still in flight: reads "Calling" and shimmers. */
  active: boolean;
  defaultOpen?: boolean;
  children: JSX.Element;
}

export function ToolGroup(props: ToolGroupProps) {
  const [expanded, setExpanded] = createSignal(props.defaultOpen ?? false);
  const title = () =>
    `${props.active ? 'Calling' : 'Called'} ${props.count} ${props.count === 1 ? 'tool' : 'tools'}`;

  return (
    <Collapsible
      open={expanded()}
      onOpenChange={setExpanded}
      class="min-w-0 text-sm leading-6 text-ink-extra-muted"
    >
      <Collapsible.Trigger class="group flex min-h-8 items-center gap-2 py-1 text-left text-ink-extra-muted hover:text-ink-muted">
        <TextShimmer text={title()} active={props.active} />
        <CaretRight
          aria-hidden="true"
          class="size-4 shrink-0 opacity-0 group-data-expanded:rotate-90 group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      </Collapsible.Trigger>
      <Collapsible.Content class="data-closed:hidden">
        <Show when={expanded()}>
          <div class="flex min-w-0 flex-col pl-6">{props.children}</div>
        </Show>
      </Collapsible.Content>
    </Collapsible>
  );
}
