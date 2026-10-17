import { createElementSize } from '@solid-primitives/resize-observer';
import { createSignal, type JSX, Suspense } from 'solid-js';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';

/** Shared virtual row engine for unified lists. Controllers own focus and paging. */
export function ListViewport<T>(props: {
  items: readonly T[];
  focusedIndex: number;
  ref?: (handle?: VirtualizerHandle) => void;
  viewportRef?: (element: HTMLDivElement) => void;
  onScroll?: () => void;
  children: (item: T) => JSX.Element;
}) {
  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const [inset, setInset] = createSignal<HTMLDivElement>();
  const insetSize = createElementSize(inset);
  return (
    <div
      ref={(element) => {
        setViewport(element);
        props.viewportRef?.(element);
      }}
      class="min-h-0 flex-1 overflow-auto overscroll-none"
    >
      <div
        ref={setInset}
        aria-hidden
        class="h-0 touch:h-[var(--list-content-inset-top,0px)]"
      />
      <Suspense>
        <Virtualizer
          ref={props.ref}
          startMargin={insetSize.height ?? 0}
          data={props.items}
          scrollRef={viewport()}
          bufferSize={240}
          itemSize={44}
          keepMounted={
            props.focusedIndex >= 0 ? [props.focusedIndex] : undefined
          }
          onScroll={props.onScroll}
        >
          {(row) => <div>{props.children(row)}</div>}
        </Virtualizer>
      </Suspense>
      <div
        aria-hidden
        class="h-0 touch:h-[var(--list-content-inset-bottom,0px)]"
      />
    </div>
  );
}
