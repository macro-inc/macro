import X from '@phosphor/x.svg';
import { Tooltip } from '@ui';
import { type JSX, onCleanup, onMount } from 'solid-js';

/** A persistent sidebar: closing it preserves the composer and scroll position. */
export function CallChatPanel(props: {
  id: string;
  open: boolean;
  onClose: () => void;
  children: JSX.Element;
  composer: JSX.Element;
}) {
  let viewport!: HTMLDivElement;
  let content!: HTMLDivElement;
  let pinned = true;

  onMount(() => {
    const observer = new ResizeObserver(() => {
      if (props.open && pinned) viewport.scrollTop = viewport.scrollHeight;
    });
    observer.observe(viewport);
    observer.observe(content);
    onCleanup(() => observer.disconnect());
  });

  return (
    <aside
      id={props.id}
      aria-label="Call chat"
      hidden={!props.open}
      class="absolute inset-y-0 right-0 z-20 w-full max-w-90 min-h-0 flex-col bg-surface @min-[800px]/call:static @min-[800px]/call:w-90 @min-[800px]/call:shrink-0"
      classList={{ flex: props.open }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        props.onClose();
      }}
    >
      <div class="flex shrink-0 items-center justify-between border-b border-edge-muted px-4 py-3">
        <h2 class="text-sm font-medium text-ink">Call chat</h2>
        <Tooltip label="Close chat">
          <button
            type="button"
            aria-label="Close chat"
            class="flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-hover hover:text-ink"
            onClick={props.onClose}
          >
            <X class="size-4" />
          </button>
        </Tooltip>
      </div>
      <div
        ref={viewport}
        class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4"
        onScroll={() => {
          if (!props.open) return;
          pinned =
            viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <
            48;
        }}
      >
        <div ref={content}>{props.children}</div>
      </div>
      <div class="shrink-0 border-t border-edge-muted p-3">
        {props.composer}
      </div>
    </aside>
  );
}
