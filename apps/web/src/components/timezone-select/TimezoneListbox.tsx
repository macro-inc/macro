import CheckIcon from '@icon/system/regular/check.svg';
import type { CollectionNode } from '@kobalte/core';
import { Combobox } from '@kobalte/core/combobox';
import type { Accessor } from 'solid-js';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';
import type { TimezoneOption } from './types';

const ITEM_HEIGHT = 32;

export function TimezoneListbox() {
  let handle: VirtualizerHandle | undefined;
  // Kobalte hands back the collection after applying its filter, so scroll
  // targeting must index the filtered list, not the original options.
  let visibleItems:
    | Accessor<Iterable<CollectionNode<TimezoneOption>>>
    | undefined;
  return (
    <Combobox.Listbox<TimezoneOption>
      scrollToItem={(key) => {
        const idx = Array.from(visibleItems?.() ?? []).findIndex(
          (item) => item.rawValue.value === key
        );
        if (idx !== -1) handle?.scrollToIndex(idx, { align: 'nearest' });
      }}
      class="max-h-[240px] overflow-y-auto scrollbar-hidden"
    >
      {(items) => {
        visibleItems = items;
        return (
          <Virtualizer
            ref={(h) => {
              handle = h;
            }}
            data={[...items()]}
            itemSize={ITEM_HEIGHT}
          >
            {(item) => (
              <Combobox.Item
                item={item}
                // Keep virtual focus in the search input inside parent popovers.
                on:mousedown={(event: MouseEvent) => event.preventDefault()}
                class="group flex w-full cursor-default items-center gap-1.5 rounded-lg p-1.5 px-2 text-left text-sm data-highlighted:bg-ink/5"
              >
                <span class="flex size-3.5 shrink-0 items-center justify-center text-accent">
                  <Combobox.ItemIndicator>
                    <CheckIcon class="size-3" />
                  </Combobox.ItemIndicator>
                </span>
                <Combobox.ItemLabel class="flex-1 truncate text-ink">
                  {item.rawValue.label}
                </Combobox.ItemLabel>
              </Combobox.Item>
            )}
          </Virtualizer>
        );
      }}
    </Combobox.Listbox>
  );
}
