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
  children: (item: T) => JSX.Element;
}) {
  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  return (
    <div
      ref={(element) => {
        setViewport(element);
        props.viewportRef?.(element);
      }}
      class="min-h-0 flex-1 overflow-auto overscroll-none"
    >
      <Suspense>
        <StickyVirtualizer
          ref={props.ref}
          data={props.items}
          isSticky={props.isSticky}
          scrollRef={viewport()}
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
    </div>
  );
}
