import CaretLeftIcon from '@phosphor/caret-left.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import { cn } from '@ui/utils/classname';
import {
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';

export type HorizontalScrollAreaProps = {
  children: JSX.Element;
  class?: string;
  contentClass?: string;
  ariaLabel?: string;
};

/**
 * A snapping horizontal scroller with overflow gradients and desktop arrows.
 */
export function HorizontalScrollArea(props: HorizontalScrollAreaProps) {
  let viewport!: HTMLDivElement;
  let content!: HTMLDivElement;
  const [canScrollLeft, setCanScrollLeft] = createSignal(false);
  const [canScrollRight, setCanScrollRight] = createSignal(false);

  const updateOverflow = () => {
    const maxScrollLeft = viewport.scrollWidth - viewport.clientWidth;
    setCanScrollLeft(viewport.scrollLeft > 1);
    setCanScrollRight(maxScrollLeft - viewport.scrollLeft > 1);
  };

  const scroll = (direction: -1 | 1) => {
    viewport.scrollBy({
      left: direction * Math.max(viewport.clientWidth * 0.7, 140),
      behavior: 'smooth',
    });
  };

  onMount(() => {
    const resizeObserver = new ResizeObserver(updateOverflow);
    resizeObserver.observe(viewport);
    resizeObserver.observe(content);

    const mutationObserver = new MutationObserver(updateOverflow);
    mutationObserver.observe(content, { childList: true, subtree: true });

    viewport.addEventListener('scroll', updateOverflow, { passive: true });
    queueMicrotask(updateOverflow);

    onCleanup(() => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      viewport.removeEventListener('scroll', updateOverflow);
    });
  });

  return (
    <div class={cn('relative min-w-0', props.class)}>
      <div
        ref={viewport}
        class="scrollbar-hidden overflow-x-auto scroll-smooth snap-x snap-mandatory"
        aria-label={props.ariaLabel}
      >
        <div
          ref={content}
          class={cn(
            'flex w-max min-w-full items-center gap-2 [&>*]:snap-start',
            props.contentClass
          )}
        >
          {props.children}
        </div>
      </div>

      <Show when={canScrollLeft()}>
        <div class="pointer-events-none absolute inset-y-0 left-0 z-1 w-12 bg-gradient-to-r from-panel to-transparent" />
        <button
          type="button"
          class="absolute left-1 top-1/2 z-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full border border-edge-muted bg-surface text-ink-muted shadow-sm hover:text-ink touch:hidden"
          aria-label="Scroll left"
          onClick={() => scroll(-1)}
        >
          <CaretLeftIcon class="size-3.5" />
        </button>
      </Show>

      <Show when={canScrollRight()}>
        <div class="pointer-events-none absolute inset-y-0 right-0 z-1 w-12 bg-gradient-to-l from-panel to-transparent" />
        <button
          type="button"
          class="absolute right-1 top-1/2 z-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full border border-edge-muted bg-surface text-ink-muted shadow-sm hover:text-ink touch:hidden"
          aria-label="Scroll right"
          onClick={() => scroll(1)}
        >
          <CaretRightIcon class="size-3.5" />
        </button>
      </Show>
    </div>
  );
}
