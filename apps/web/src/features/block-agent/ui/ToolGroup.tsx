/**
 * A stable summary for a run of calls. Fast bursts stay compact; ongoing work
 * opens a bounded, scrolling window and settles with one delay for the run.
 *
 * Shaped like `Thought` rather than `ToolCard`: a bare caret row, no surface,
 * because the cards themselves appear once it opens.
 */

import { CollapseTransition } from '@app/components/view-shell/CollapseTransition';
import CaretRight from '@phosphor/caret-right.svg';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import {
  createEffect,
  createSignal,
  createUniqueId,
  type JSX,
  on,
  onMount,
} from 'solid-js';
import { TextShimmer } from './TextShimmer';

export interface ToolGroupProps {
  count: number;
  /** A call in the run is still in flight: reads "Calling" and shimmers. */
  active: boolean;
  /** Child position of the first running call, so later results cannot bury it. */
  activeIndex?: number;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** One element per call/thought, each at least one compact row tall. */
  children: JSX.Element;
}

/** Five compact tool rows, with history available without growing the transcript. */
function ToolWindow(props: {
  children: JSX.Element;
  follow: boolean;
  activeIndex?: number;
  id: string;
  onInteract: () => void;
}) {
  let viewport!: HTMLDivElement;
  const [content, setContent] = createSignal<HTMLDivElement>();
  let following = props.follow;
  let scrolling = false;
  const atBottom = () =>
    viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 16;
  const scrollTarget = () => {
    const row = content()?.children[props.activeIndex ?? -1];
    if (!row) return viewport.scrollHeight;
    return Math.max(
      0,
      row.getBoundingClientRect().bottom -
        viewport.getBoundingClientRect().top +
        viewport.scrollTop -
        viewport.clientHeight
    );
  };
  const followLatest = () => {
    if (!following) return;
    scrolling = true;
    viewport.scrollTo({
      top: scrollTarget(),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
  };
  const stopFollowing = () => {
    following = false;
    scrolling = false;
    props.onInteract();
  };

  createResizeObserver(content, followLatest);
  createEffect(
    on(
      () => props.activeIndex,
      (index) => {
        if (index !== undefined) followLatest();
      },
      { defer: true }
    )
  );
  onMount(() => {
    // Follow unfinished work first; reviewing history starts at the top.
    if (following) viewport.scrollTop = scrollTarget();
  });

  return (
    <div
      id={props.id}
      ref={viewport}
      role="region"
      aria-label="Tool calls"
      tabIndex={0}
      class="max-h-40 overflow-y-auto overscroll-contain [overflow-anchor:none]"
      onWheel={stopFollowing}
      onTouchMove={stopFollowing}
      onPointerDown={stopFollowing}
      onFocusIn={stopFollowing}
      onKeyDown={(event) => {
        if (
          [
            'ArrowUp',
            'ArrowDown',
            'PageUp',
            'PageDown',
            'Home',
            'End',
            ' ',
          ].includes(event.key)
        ) {
          stopFollowing();
        }
      }}
      onScroll={() => {
        if (!scrolling) following = atBottom();
      }}
      on:scrollend={() => {
        scrolling = false;
      }}
    >
      <div ref={setContent} class="flex min-w-0 flex-col pl-6">
        {props.children}
      </div>
    </div>
  );
}

export function ToolGroup(props: ToolGroupProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = createSignal(
    props.defaultOpen ?? false
  );
  const expanded = () => props.open ?? uncontrolledOpen();
  const setExpanded = (open: boolean) => {
    setUncontrolledOpen(open);
    props.onOpenChange?.(open);
  };
  const contentId = createUniqueId();
  const title = () =>
    `${props.active ? 'Calling' : 'Called'} ${props.count} ${props.count === 1 ? 'tool' : 'tools'}`;

  return (
    <div class="min-w-0 text-sm leading-6 text-ink-extra-muted">
      <button
        type="button"
        aria-expanded={expanded()}
        aria-controls={contentId}
        class="group flex min-h-8 items-center gap-2 py-1 text-left text-ink-extra-muted hover:text-ink-muted"
        onClick={() => setExpanded(!expanded())}
      >
        <TextShimmer text={title()} active={props.active} />
        <CaretRight
          aria-hidden="true"
          class="size-4 shrink-0 opacity-0 transition-transform group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
          classList={{ 'rotate-90': expanded() }}
        />
      </button>
      <CollapseTransition open={expanded()}>
        <div>
          <ToolWindow
            id={contentId}
            follow={props.active}
            activeIndex={props.activeIndex}
            onInteract={() => setExpanded(true)}
          >
            {props.children}
          </ToolWindow>
        </div>
      </CollapseTransition>
    </div>
  );
}
