import {
  createVirtualizer,
  defaultRangeExtractor,
  type Range,
  type VirtualItem,
} from '@tanstack/solid-virtual';
import { useDragDropContext } from '@thisbeyond/solid-dnd';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
  onMount,
} from 'solid-js';

export type KanbanScrollSnapshot = {
  offset: number;
  measurements: VirtualItem[];
};

type KanbanVirtualizerOptions = {
  keys: Accessor<readonly (string | number)[]>;
  getScrollElement: () => HTMLDivElement | undefined;
  estimateSize: number;
  gap: number;
  overscan: number;
  paddingStart?: number;
  paddingEnd?: number;
  snapshot?: KanbanScrollSnapshot;
} & (
  | { direction: 'horizontal' }
  | { direction: 'vertical'; laneId: Accessor<string> }
);

/** Keep the drag source mounted even when its column or card leaves the viewport. */
export function createKanbanVirtualizer(options: KanbanVirtualizerOptions) {
  const context = useDragDropContext();

  if (!context) {
    throw new Error('Kanban virtualizers require a Kanban provider');
  }

  const [state, actions] = context;
  const [scrollElement, setScrollElement] = createSignal<HTMLDivElement>();

  onMount(() => {
    // Suspense can create the viewport in an inert document before attaching it.
    // Binding there leaves the virtualizer without a window or resize observer.
    const observer = new MutationObserver(connect);

    function connect() {
      const element = options.getScrollElement();

      if (!element?.isConnected) {
        return;
      }

      observer.disconnect();
      setScrollElement(element);
    }

    observer.observe(document, { childList: true, subtree: true });
    connect();
    onCleanup(() => observer.disconnect());
  });

  const pinnedIndex = () => {
    const source = state.active.draggable?.data;

    if (source?.kind !== 'card') {
      return -1;
    }

    if (options.direction === 'horizontal') {
      return options.keys().indexOf(source.laneId);
    }

    if (source.laneId !== options.laneId()) {
      return -1;
    }

    return options.keys().indexOf(source.itemId);
  };

  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    get count() {
      return options.keys().length;
    },
    get getItemKey() {
      const keys = options.keys();

      return (index: number) => keys[index];
    },
    getScrollElement: () => scrollElement() ?? null,
    horizontal: options.direction === 'horizontal',
    estimateSize: () => options.estimateSize,
    gap: options.gap,
    overscan: options.overscan,
    paddingStart: options.paddingStart,
    paddingEnd: options.paddingEnd,
    initialOffset: options.snapshot?.offset,
    initialMeasurementsCache: options.snapshot?.measurements,
    get rangeExtractor() {
      const index = pinnedIndex();

      return (range: Range) => {
        const indexes = defaultRangeExtractor(range);

        if (index < 0 || index >= range.count || indexes.includes(index)) {
          return indexes;
        }

        return [...indexes, index].sort((a, b) => a - b);
      };
    },
  });

  createEffect(
    on(
      () => virtualizer.getVirtualItems(),
      () => {
        if (!state.active.draggable) {
          return;
        }

        // New virtual columns mount after the scroll event's collision pass.
        queueMicrotask(() => {
          if (state.active.draggable) {
            actions.detectCollisions();
          }
        });
      }
    )
  );

  return virtualizer;
}
