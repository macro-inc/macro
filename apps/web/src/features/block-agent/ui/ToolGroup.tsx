/** Consecutive calls collect in an open group while live, then fold to one row. */

import { Collapsible } from '@kobalte/core/collapsible';
import CaretRight from '@phosphor/caret-right.svg';
import { createWritableMemo } from '@solid-primitives/memo';
import { createScheduled, debounce } from '@solid-primitives/scheduled';
import { createMemo, type JSX, on, Show } from 'solid-js';
import { TextShimmer } from './TextShimmer';

/** Let a fast result remain readable and bridge brief gaps between calls. */
const SETTLE_DELAY_MS = 700;

export interface ToolGroupProps {
  count: number;
  /** A call in the run is still in flight: reads "Calling" and shimmers. */
  active: boolean;
  /** The live tail can receive calls already completed in the same batch. */
  live?: boolean;
  defaultOpen?: boolean;
  children: JSX.Element;
}

export function ToolGroup(props: ToolGroupProps) {
  const settled = createScheduled((callback) =>
    debounce(callback, SETTLE_DELAY_MS)
  );
  const automaticOpen = createMemo((wasOpen: boolean) => {
    const active = props.active;
    // Each new call extends the grace period, including completed batches.
    const live = (props.live ?? active) && props.count > 0;
    const readyToClose = settled();
    return active || (!readyToClose && (live || wasOpen));
  }, false);
  const [expanded, setExpanded] = createWritableMemo<boolean>(
    on(automaticOpen, (open, previous) =>
      previous === undefined ? (props.defaultOpen ?? open) : open
    )
  );
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
