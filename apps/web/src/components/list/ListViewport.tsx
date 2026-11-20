import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { followContentInsetBottom } from '@core/mobile/viewport-insets';
import { createElementSize } from '@solid-primitives/resize-observer';
import { createSignal, type JSX, Suspense } from 'solid-js';
import type { VirtualizerHandle } from 'virtua/solid';
import { StickyVirtualizer } from './StickyVirtualizer';

/** Shared virtual row engine for unified lists. Controllers own focus and paging. */
export function ListViewport<T>(props: {
  items: readonly T[];
  focusedIndex: number;
  ref?: (handle?: VirtualizerHandle) => void;
  viewportRef?: (element: HTMLDivElement) => void;
  onScroll?: () => void;
  isSticky?: (item: T) => boolean;
  /** A host scroller can place its own summary and pinned chrome before the rows. */
  scrollContainer?: HTMLElement;
  scrollStart?: number;
  stickyInset?: number;
  /** Scrolls above the rows, outside them, so list focus skips it. */
  start?: JSX.Element;
  /** Reserve floating touch chrome inside this list's own scroller. */
  touchInset?: boolean;
  children: (item: T) => JSX.Element;
}) {
  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const [start, setStart] = createSignal<HTMLDivElement>();
  const startSize = createElementSize(start);
  const [inset, setInset] = createSignal<HTMLDivElement>();
  const insetSize = createElementSize(inset);
  return (
    <div
      ref={(element) => {
        setViewport(element);
        if (!props.scrollContainer) props.viewportRef?.(element);
      }}
      class={
        props.scrollContainer
          ? 'min-w-0'
          : 'min-h-0 flex-1 overflow-auto overscroll-none'
      }
    >
      <div ref={setStart}>
        <div
          ref={setInset}
          aria-hidden
          class={
            props.touchInset
              ? 'h-0 touch:h-(--mobile-content-inset-top)'
              : 'h-0'
          }
        />
        {props.start}
      </div>
      <Suspense>
        <StickyVirtualizer
          ref={props.ref}
          data={props.items}
          isSticky={isTouchDevice() ? undefined : props.isSticky}
          scrollRef={props.scrollContainer ?? viewport()}
          startMargin={(props.scrollStart ?? 0) + (startSize.height ?? 0)}
          stickyInset={props.stickyInset ?? insetSize.height ?? 0}
          bufferSize={240}
          itemSize={44}
          keepMounted={
            props.focusedIndex >= 0 ? [props.focusedIndex] : undefined
          }
          onScroll={props.onScroll}
        >
          {(row) => <div>{props.children(row)}</div>}
        </StickyVirtualizer>
      </Suspense>
      {props.touchInset && !props.scrollContainer && (
        <div
          ref={followContentInsetBottom}
          aria-hidden
          class="h-0 touch:h-[calc(max(var(--safe-bottom,0px),var(--mobile-content-inset-bottom,0px))+16px)]"
        />
      )}
    </div>
  );
}
