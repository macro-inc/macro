import { isMobile } from '@core/mobile/isMobile';
import { createEffect, type JSX, on, onCleanup, onMount } from 'solid-js';

/** Keep the message history and composer mounted across tab and layout changes. */
export function CallChatBody(props: {
  open: boolean;
  children: JSX.Element;
  composer: JSX.Element;
}) {
  let viewport!: HTMLDivElement;
  let content!: HTMLDivElement;
  let pinned = true;
  let scrollTop = 0;

  createEffect(
    on([isMobile, () => props.open], () => {
      if (props.open) viewport.scrollTop = scrollTop;
    })
  );

  onMount(() => {
    const observer = new ResizeObserver(() => {
      if (props.open && pinned) {
        viewport.scrollTop = viewport.scrollHeight;
        scrollTop = viewport.scrollTop;
      }
    });
    observer.observe(viewport);
    observer.observe(content);
    onCleanup(() => observer.disconnect());
  });

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div
        ref={viewport}
        data-channel-scroll
        class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4"
        onScroll={() => {
          if (!props.open || !viewport.clientHeight) return;
          scrollTop = viewport.scrollTop;
          pinned =
            viewport.scrollHeight - scrollTop - viewport.clientHeight < 48;
        }}
      >
        <div ref={content}>{props.children}</div>
      </div>
      <div class="shrink-0 p-3">{props.composer}</div>
    </div>
  );
}
