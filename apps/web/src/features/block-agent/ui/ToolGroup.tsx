/** Consecutive calls collect in an open group while live, then fold to one row. */

import { Collapsible } from '@kobalte/core/collapsible';
import CaretUp from '@phosphor/caret-up.svg';
import { createWritableMemo } from '@solid-primitives/memo';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { createScheduled, debounce } from '@solid-primitives/scheduled';
import {
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  on,
  onCleanup,
} from 'solid-js';
import { TextShimmer } from './TextShimmer';

/** Let a fast result remain readable and bridge brief gaps between calls. */
const SETTLE_DELAY_MS = 700;
const GROW_DURATION_MS = 180;

export interface ToolGroupProps {
  count: number;
  /** A call in the run is still in flight: reads "Calling" and shimmers. */
  active: boolean;
  /** The live tail can receive calls already completed in the same batch. */
  live?: boolean;
  defaultOpen?: boolean;
  children: JSX.Element;
}

function ToolGroupContent(props: { open: boolean; children: JSX.Element }) {
  let content!: HTMLDivElement;
  const [rows, setRows] = createSignal<HTMLDivElement>();
  let height: number | undefined;
  let growth: Animation | undefined;

  createResizeObserver(rows, ({ height: nextHeight }) => {
    const previousHeight = height;
    height = nextHeight;
    // Kobalte measures when opening. Keep the exit height current as calls
    // arrive or an individual result is expanded inside the group.
    content.style.setProperty(
      '--kb-accordion-content-height',
      `${nextHeight}px`
    );
    if (
      previousHeight === undefined ||
      previousHeight === nextHeight ||
      !props.open ||
      typeof content.animate !== 'function' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;

    const fromHeight = growth
      ? content.getBoundingClientRect().height
      : previousHeight;
    growth?.cancel();
    growth = content.animate(
      [{ height: `${fromHeight}px` }, { height: `${nextHeight}px` }],
      { duration: GROW_DURATION_MS, easing: 'ease-out' }
    );
    growth.onfinish = () => {
      growth = undefined;
    };
  });
  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) growth?.cancel();
      }
    )
  );
  onCleanup(() => growth?.cancel());

  return (
    <Collapsible.Content
      ref={content}
      inert={!props.open}
      class="overflow-hidden data-expanded:animate-accordion-down data-closed:animate-accordion-up motion-reduce:animate-none"
      style={{
        '--kb-accordion-content-height': 'var(--kb-collapsible-content-height)',
      }}
    >
      <div
        ref={(element) => {
          height = undefined;
          setRows(element);
        }}
        class="flex min-w-0 flex-col pl-6"
      >
        {props.children}
      </div>
    </Collapsible.Content>
  );
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
        <CaretUp
          aria-hidden="true"
          class="size-4 shrink-0 transition-transform group-data-expanded:rotate-180 motion-reduce:transition-none"
        />
        <TextShimmer text={title()} active={props.active} />
      </Collapsible.Trigger>
      <ToolGroupContent open={expanded()}>{props.children}</ToolGroupContent>
    </Collapsible>
  );
}
