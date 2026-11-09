import { createVirtualizer } from '@tanstack/solid-virtual';
import { createEffect, For, Show, untrack } from 'solid-js';
import type { MentionItem } from '../../../../utils/mentionsUtils';
import { MentionsMenuItem } from './MentionsMenuItem';

const VIRTUAL_ITEM_HEIGHT = 36;

export function VirtualizedItemList(props: {
  items: MentionItem[];
  selectedIndex: number;
  itemAction: (item: MentionItem) => void;
  /** Whether an item's agent runtime is away; such rows are not pickable. */
  offline: (item: MentionItem) => boolean;
  setIndex: (index: number) => void;
  setOpen: (open: boolean) => void;
  maxHeight?: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  onEndReached: () => void;
}) {
  let scrollContainerRef: HTMLDivElement | undefined;

  const virtualizer = createVirtualizer({
    get count() {
      return props.items.length;
    },
    getScrollElement: () => scrollContainerRef ?? null,
    estimateSize: () => VIRTUAL_ITEM_HEIGHT,
    overscan: 5,
  });

  // Scroll selected item into view
  createEffect(() => {
    const index = props.selectedIndex;
    const itemCount = untrack(() => props.items.length);
    if (index >= 0 && index < itemCount) {
      virtualizer.scrollToIndex(index, { align: 'auto' });
    }
  });

  return (
    <div
      ref={scrollContainerRef}
      onScroll={(event) => {
        if (!props.hasMore || props.isLoadingMore) return;
        const target = event.currentTarget;
        const remaining =
          target.scrollHeight - target.scrollTop - target.clientHeight;
        if (remaining <= VIRTUAL_ITEM_HEIGHT * 5) props.onEndReached();
      }}
      class="overflow-y-auto scrollbar-hidden"
      style={{
        'max-height':
          props.maxHeight !== undefined ? `${props.maxHeight}px` : '16rem',
      }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        <For each={virtualizer.getVirtualItems()}>
          {(virtualRow) => {
            const item = () => props.items[virtualRow.index];
            return (
              <Show when={item()}>
                {(currentItem) => (
                  <div
                    class="ph-no-capture"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <MentionsMenuItem
                      item={currentItem()}
                      index={virtualRow.index}
                      selected={virtualRow.index === props.selectedIndex}
                      itemAction={props.itemAction}
                      setIndex={props.setIndex}
                      setOpen={props.setOpen}
                      offline={props.offline(currentItem())}
                      disableScrollIntoView
                    />
                  </div>
                )}
              </Show>
            );
          }}
        </For>
      </div>
    </div>
  );
}
