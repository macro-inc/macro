import CaretRight from '@phosphor/caret-right.svg?component-solid';
import { cn } from '@ui';
import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

// Max rendered height (px) before a message in the conversation collapses.
// Mirrors the Tailwind `max-h-80` class applied when collapsed.
const MAX_HEIGHT = 320;

/**
 * Wraps a rendered chat message and caps its height. When the content exceeds
 * MAX_HEIGHT it collapses and shows a "Show more" button; the user can expand
 * it to the full height and collapse it again.
 *
 * This is intended for the message chain (the rendered conversation) only — it
 * must not be used around the chat input box.
 */
export function CollapsibleMessage(props: { children: JSX.Element }) {
  const [expanded, setExpanded] = createSignal(false);
  const [overflowing, setOverflowing] = createSignal(false);
  let contentRef!: HTMLDivElement;

  const measure = () => {
    if (!contentRef) return;
    setOverflowing(contentRef.scrollHeight > MAX_HEIGHT + 1);
  };

  onMount(() => {
    measure();
    const observer = new ResizeObserver(() => measure());
    observer.observe(contentRef);
    onCleanup(() => observer.disconnect());
  });

  const collapsed = () => overflowing() && !expanded();

  return (
    <div class="flex w-full min-w-0 flex-col">
      <div
        ref={contentRef}
        class={cn('min-w-0', collapsed() && 'max-h-80 overflow-hidden')}
      >
        {props.children}
      </div>
      <Show when={overflowing()}>
        <button
          type="button"
          class="mt-1 flex items-center gap-1 self-start text-xs text-ink-extra-muted hover:text-ink-muted"
          onClick={() => setExpanded((prev) => !prev)}
        >
          <CaretRight
            class="size-3 shrink-0 transition-transform"
            classList={{ 'rotate-90': expanded() }}
          />
          <span>{expanded() ? 'Show less' : 'Show more'}</span>
        </button>
      </Show>
    </div>
  );
}
