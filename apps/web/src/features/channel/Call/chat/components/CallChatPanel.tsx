import { type JSX, onCleanup, onMount } from 'solid-js';

/**
 * The call sidebar's Chat tab. It stays mounted while hidden, so switching
 * tabs or closing the sidebar preserves the composer and scroll position.
 */
export function CallChatPanel(props: {
  id: string;
  open: boolean;
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
    <section
      id={props.id}
      aria-label="Call chat"
      hidden={!props.open}
      class="min-h-0 flex-1 flex-col"
      classList={{ flex: props.open }}
    >
      <div
        ref={viewport}
        data-channel-scroll
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
      <div class="shrink-0 p-3">{props.composer}</div>
    </section>
  );
}
