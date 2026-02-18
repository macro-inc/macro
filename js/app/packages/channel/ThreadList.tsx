import { type Accessor, type JSX, createSignal } from 'solid-js';
import { type VirtualizerHandle, VList } from 'virtua/solid';
import type { ScrollToIndexOpts } from 'virtua/unstable_core';

type ScrollAlignment = ScrollToIndexOpts['align'];
export type ThreadListScrollTarget =
  | {
      tag: 'top';
      align?: ScrollAlignment;
    }
  | {
      tag: 'bottom';
      align?: ScrollAlignment;
    }
  | {
      tag: 'index';
      index: number;
      align?: ScrollAlignment;
    }
  | {
      tag: 'id';
      id: string;
      align?: ScrollAlignment;
    };

export type ThreadListNavigation = {
  scrollTo: (target: ThreadListScrollTarget) => boolean;
  scrollToIndex: (index: number, opts?: { align?: ScrollAlignment }) => boolean;
  scrollByDelta: (delta: number, opts?: { align?: ScrollAlignment }) => boolean;
  scrollToTop: (align?: ScrollAlignment) => boolean;
  scrollToBottom: (align?: ScrollAlignment) => boolean;
  scrollToId: (id: string, opts?: { align?: ScrollAlignment }) => boolean;
  navigatePrevious: () => boolean;
  navigateNext: () => boolean;
};

type ThreadListProps<T extends { id: string }> = {
  data: Accessor<T[]>;
  children: (item: T) => JSX.Element;
  initialScrollTarget?: ThreadListScrollTarget;
  onScrollNearTop?: () => void;
  onScrollNearBottom?: () => void;
  onNavigationReady?: (navigation: ThreadListNavigation) => void;
  isPrepending?: Accessor<boolean>;
};

const NEAR_TOP_THRESHOLD = 600;
const NEAR_BOTTOM_THRESHOLD = 1.5;
const BASE_ITEM_SIZE = 50;
export const DEFAULT_INITIAL_SCROLL_TARGET: ThreadListScrollTarget = {
  tag: 'bottom',
  align: 'end',
};

const clamp = (index: number, min: number, max: number) =>
  Math.max(min, Math.min(index, max));

function getTargetAlign(target: ThreadListScrollTarget): ScrollAlignment {
  if (target.align) return target.align;

  switch (target.tag) {
    case 'top':
      return 'start';
    case 'bottom':
      return 'end';
    case 'index':
    case 'id':
      return 'nearest';
  }
}

export function ThreadList<T extends { id: string }>(
  props: ThreadListProps<T>
) {
  const [virtualHandle, setVirtualHandle] = createSignal<VirtualizerHandle>();
  const [isNearBottom, setIsNearBottom] = createSignal(false);

  const resolveTargetIndex = (target: ThreadListScrollTarget): number => {
    const items = props.data();
    const maxIndex = items.length - 1;

    if (maxIndex < 0) return -1;

    switch (target.tag) {
      case 'top':
        return 0;
      case 'bottom':
        return maxIndex;
      case 'index':
        return clamp(target.index, 0, maxIndex);
      case 'id':
        return items.findIndex((item) => item.id === target.id);
    }
  };

  const scrollToTarget = (
    handle: VirtualizerHandle,
    target: ThreadListScrollTarget
  ): boolean => {
    const index = resolveTargetIndex(target);
    if (index < 0) return false;

    handle.scrollToIndex(index, {
      align: getTargetAlign(target),
    });
    return true;
  };

  const getCurrentIndex = (handle: VirtualizerHandle): number => {
    const itemCount = props.data().length;
    if (!itemCount) return -1;

    return clamp(handle.findItemIndex(handle.scrollOffset), 0, itemCount - 1);
  };

  const createNavigation = (
    handle: VirtualizerHandle
  ): ThreadListNavigation => ({
    scrollTo: (target) => {
      return scrollToTarget(handle, target);
    },
    scrollToIndex: (index, opts = {}) => {
      return scrollToTarget(handle, {
        tag: 'index',
        index,
        align: opts.align,
      });
    },
    scrollByDelta: (delta, opts = {}) => {
      const currentIndex = getCurrentIndex(handle);
      if (currentIndex < 0) return false;

      return scrollToTarget(handle, {
        tag: 'index',
        index: currentIndex + delta,
        align: opts.align,
      });
    },
    scrollToTop: (align = 'start') => {
      return scrollToTarget(handle, { tag: 'top', align });
    },
    scrollToBottom: (align = 'end') => {
      return scrollToTarget(handle, { tag: 'bottom', align });
    },
    scrollToId: (id, opts = {}) => {
      return scrollToTarget(handle, {
        tag: 'id',
        id,
        align: opts.align,
      });
    },
    navigatePrevious: () => {
      const currentIndex = getCurrentIndex(handle);
      if (currentIndex < 0) return false;

      return scrollToTarget(handle, {
        tag: 'index',
        index: currentIndex - 1,
      });
    },
    navigateNext: () => {
      const currentIndex = getCurrentIndex(handle);
      if (currentIndex < 0) return false;

      return scrollToTarget(handle, {
        tag: 'index',
        index: currentIndex + 1,
      });
    },
  });

  const handleScroll = () => {
    const handle = virtualHandle();
    if (!handle) return;

    const nearTop = handle.scrollOffset <= NEAR_TOP_THRESHOLD;
    const nearBottom =
      handle.scrollSize - handle.viewportSize - handle.scrollOffset <=
      NEAR_BOTTOM_THRESHOLD;

    if (nearTop && !nearBottom) {
      props.onScrollNearTop?.();
    }

    if (nearBottom && !nearTop && !isNearBottom()) {
      props.onScrollNearBottom?.();
    }

    setIsNearBottom(nearBottom);
  };

  return (
    <VList
      ref={(ref) => {
        if (!ref) return;
        setVirtualHandle(ref);
        if (props.onNavigationReady) {
          props.onNavigationReady(createNavigation(ref));
        }
        scrollToTarget(
          ref,
          props.initialScrollTarget ?? DEFAULT_INITIAL_SCROLL_TARGET
        );
      }}
      data={props.data()}
      itemSize={BASE_ITEM_SIZE}
      bufferSize={10 * BASE_ITEM_SIZE}
      onScroll={handleScroll}
      shift={props.isPrepending ? props.isPrepending() : false}
      style={{
        'overflow-anchor': 'none',
        display: 'flex',
      }}
    >
      {(item) => props.children(item)}
    </VList>
  );
}
