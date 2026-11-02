import { createElementSize } from '@solid-primitives/resize-observer';
import { createEffect, createMemo, createSignal, type JSX, on } from 'solid-js';
import {
  Virtualizer,
  type VirtualizerHandle,
  type VirtualizerProps,
} from 'virtua/solid';
import { getStickyHeader, getStickyScrollOptions } from './sticky-header';

type VirtualItemProps = {
  index: number;
  ref: (element: HTMLDivElement) => void;
  style: JSX.CSSProperties;
  children: JSX.Element;
};

type StickyVirtualizerProps<T> = Omit<VirtualizerProps<T>, 'as' | 'item'> & {
  isSticky?: (item: T) => boolean;
  /** Persistent viewport chrome, distinct from the in-flow startMargin. */
  stickyInset?: number;
};

/** Retains the real current header, rather than rendering a second overlay. */
export function StickyVirtualizer<T>(props: StickyVirtualizerProps<T>) {
  const [handle, setHandle] = createSignal<VirtualizerHandle>();
  const [root, setRoot] = createSignal<HTMLDivElement>();
  const size = createElementSize(() => (props.isSticky ? root() : undefined));
  const [scrollOffset, setScrollOffset] = createSignal(0);
  const indexes = createMemo(() =>
    props.isSticky
      ? props.data.flatMap((item, index) =>
          props.isSticky?.(item) ? [index] : []
        )
      : []
  );
  const layout = () => ({
    indexes: indexes(),
    geometry: handle(),
    startMargin: props.startMargin ?? 0,
    inset: props.stickyInset ?? 0,
  });
  const [placement, setPlacement] =
    createSignal<ReturnType<typeof getStickyHeader>>();
  const updatePlacement = () => {
    const current = layout();
    setPlacement(
      current.geometry
        ? getStickyHeader({ ...current, geometry: current.geometry })
        : undefined
    );
  };
  // Virtua updates its mutable geometry cache in a pure computation. Read that
  // external cache in an effect, after it has synchronized with new rows.
  createEffect(
    on(
      () => [
        indexes(),
        handle(),
        scrollOffset(),
        size.width,
        size.height,
        props.startMargin,
        props.stickyInset,
      ],
      updatePlacement
    )
  );
  const pinned = createMemo(() => placement()?.index);
  const keepMounted = createMemo(() => {
    const mounted = new Set(props.keepMounted);
    const index = pinned();
    if (index !== undefined) mounted.add(index);
    return [...mounted].filter(
      (index) => index >= 0 && index < props.data.length
    );
  });
  const Item = (item: VirtualItemProps) => {
    // Row offsets can change while the total list size stays unchanged.
    createEffect(on(() => item.style, updatePlacement, { defer: true }));
    return (
      <div
        ref={item.ref}
        class={item.index === pinned() ? 'bg-panel' : undefined}
        style={{
          ...item.style,
          ...(item.index === pinned()
            ? {
                position: 'sticky',
                top: `${placement()?.top ?? 0}px`,
                'z-index': 1,
                'pointer-events': 'auto',
              }
            : {}),
        }}
      >
        {item.children}
      </div>
    );
  };
  const Root = (container: Omit<VirtualItemProps, 'index'>) => (
    <div
      ref={(element) => {
        setRoot(element);
        container.ref(element);
      }}
      style={container.style}
    >
      {container.children}
    </div>
  );
  const register = (virtualizer?: VirtualizerHandle) => {
    setHandle(virtualizer);
    if (!virtualizer) {
      props.ref?.(undefined);
      return;
    }
    props.ref?.({
      get cache() {
        return virtualizer.cache;
      },
      get scrollOffset() {
        return virtualizer.scrollOffset;
      },
      get scrollSize() {
        return virtualizer.scrollSize;
      },
      get viewportSize() {
        return virtualizer.viewportSize;
      },
      findItemIndex: virtualizer.findItemIndex,
      getItemOffset: virtualizer.getItemOffset,
      getItemSize: virtualizer.getItemSize,
      scrollTo: virtualizer.scrollTo,
      scrollBy: virtualizer.scrollBy,
      scrollToIndex: (index, options) => {
        if (!props.isSticky) {
          virtualizer.scrollToIndex(index, options);
          return;
        }
        const target = Math.max(0, Math.min(index, props.data.length - 1));
        const next = getStickyScrollOptions(
          { ...layout(), geometry: virtualizer },
          target,
          options
        );
        if (next) virtualizer.scrollToIndex(target, next);
      },
    });
  };
  return (
    <Virtualizer
      {...props}
      as={Root}
      item={Item}
      ref={register}
      keepMounted={keepMounted()}
      onScroll={(offset) => {
        setScrollOffset(offset);
        props.onScroll?.(offset);
      }}
    />
  );
}
