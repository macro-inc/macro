import type { ListScrollHandle } from '@app/components/list';
import { onElementConnect } from '@core/util/onElementConnect';
import { Key } from '@solid-primitives/keyed';
import {
  createVirtualizer,
  defaultRangeExtractor,
  type Range,
} from '@tanstack/solid-virtual';
import {
  createEffect,
  createSignal,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
  untrack,
} from 'solid-js';

export type ChannelRailVirtualizerHandle = ListScrollHandle & {
  visibleRange: () => { startIndex: number; endIndex: number } | undefined;
  scrollMetrics: () => { size: number; offset: number; viewport: number };
};

type ChannelRailVirtualizerProps<K extends string> = {
  keys: readonly K[];
  scrollRoot: HTMLDivElement | undefined;
  scrollMargin?: number;
  estimateSize: number;
  overscan?: number;
  keepMounted?: readonly number[];
  ref?: (handle: ChannelRailVirtualizerHandle | undefined) => void;
  onRangeChange?: () => void;
  children: (key: K) => JSX.Element;
};

function VirtualRows<K extends string>(
  props: ChannelRailVirtualizerProps<K> & { scrollRoot: HTMLDivElement }
) {
  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    get count() {
      return props.keys.length;
    },
    get getItemKey() {
      const keys = props.keys;
      return (index: number) => keys[index];
    },
    getScrollElement: () => props.scrollRoot,
    estimateSize: () => props.estimateSize,
    initialOffset: () => props.scrollRoot.scrollTop,
    get scrollMargin() {
      return props.scrollMargin ?? 0;
    },
    get overscan() {
      return props.overscan ?? 6;
    },
    get rangeExtractor() {
      const retained = props.keepMounted ?? [];
      return (range: Range) => {
        const indexes = new Set(defaultRangeExtractor(range));

        for (const index of retained) {
          if (index >= 0 && index < range.count) indexes.add(index);
        }

        return [...indexes].sort((a, b) => a - b);
      };
    },
  });

  const handle: ChannelRailVirtualizerHandle = {
    scrollToIndex: (index, options) => {
      const align = options?.align;

      virtualizer.scrollToIndex(index, {
        align: !align || align === 'nearest' ? 'auto' : align,
      });
    },
    visibleRange: () => {
      virtualizer.getVirtualItems();
      return virtualizer.range ?? undefined;
    },
    scrollMetrics: () => ({
      size: virtualizer.getTotalSize(),
      offset: props.scrollRoot.scrollTop,
      viewport: props.scrollRoot.clientHeight,
    }),
  };

  onMount(() => {
    props.ref?.(handle);
    props.onRangeChange?.();
  });

  onCleanup(() => props.ref?.(undefined));

  createEffect(
    on(
      [
        () => virtualizer.getVirtualItems().map((row) => row.index),
        () => virtualizer.getTotalSize(),
      ],
      () => props.onRangeChange?.()
    )
  );

  return (
    <div
      class="relative w-full"
      style={{ height: `${virtualizer.getTotalSize()}px` }}
    >
      <Key each={virtualizer.getVirtualItems()} by="key">
        {(row) => {
          const key = untrack(() => props.keys[row().index]);
          let element: HTMLDivElement | undefined;

          createEffect(
            on(
              () => row().index,
              (index) => {
                if (!element) return;

                element.dataset.index = String(index);
                virtualizer.measureElement(element);
              }
            )
          );

          onCleanup(() => virtualizer.measureElement(null));

          return (
            <div
              ref={(node) => {
                element = node;
              }}
              data-index={row().index}
              class="absolute left-0 w-full"
              style={{
                top: `${row().start - (props.scrollMargin ?? 0)}px`,
              }}
            >
              {props.children(key)}
            </div>
          );
        }}
      </Key>
    </div>
  );
}

/** Observe only connected scroll roots, including roots attached after Suspense. */
export function ChannelRailVirtualizer<K extends string>(
  props: ChannelRailVirtualizerProps<K>
) {
  const [connectedRoot, setConnectedRoot] = createSignal<HTMLDivElement>();

  createEffect(
    on(
      () => props.scrollRoot,
      (root) => {
        setConnectedRoot(undefined);

        if (!root) return;

        let active = true;
        onCleanup(() => {
          active = false;
        });

        onElementConnect(root, () => {
          if (active) setConnectedRoot(root);
        });
      }
    )
  );

  return (
    <Show when={connectedRoot()} keyed>
      {(root) => <VirtualRows {...props} scrollRoot={root} />}
    </Show>
  );
}
