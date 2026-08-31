import type { CollectionNode } from '@kobalte/core';
import { Combobox } from '@kobalte/core/combobox';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import { cn, Layer } from '@ui';
import { type Accessor, createMemo, createSignal, Show } from 'solid-js';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';

export type TimezoneOption = { value: string; label: string };

const ITEM_HEIGHT = 32;

const VirtualizedListbox = () => {
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
};

/**
 * A single-select timezone dropdown built on the same portalled, searchable
 * Combobox the rest of the app uses, so a 400-zone list stays a normal-sized
 * scrollable menu rather than the browser's full-height native picker.
 */
export function TimezoneSelect(props: {
  value: string;
  onChange: (zone: string) => void;
  options: TimezoneOption[];
  class?: string;
}) {
  const [search, setSearch] = createSignal('');
  // Keep the current zone in the collection even when the runtime no longer
  // lists it (a zone dropped between releases), so it resolves as the selection
  // and a stray pick cannot silently replace a still-valid stored zone.
  const optionsWithCurrent = createMemo(() =>
    props.options.some((option) => option.value === props.value)
      ? props.options
      : [
          { value: props.value, label: props.value.replace(/_/g, ' ') },
          ...props.options,
        ]
  );
  const selected = () =>
    optionsWithCurrent().find((option) => option.value === props.value) ?? null;
  const triggerLabel = () =>
    selected()?.label ?? props.value.replace(/_/g, ' ');
  const hasMatches = () => {
    const query = search().trim().toLowerCase();
    if (!query) return optionsWithCurrent().length > 0;
    return optionsWithCurrent().some((option) =>
      option.label.toLowerCase().includes(query)
    );
  };

  return (
    <Combobox<TimezoneOption>
      multiple={false}
      options={optionsWithCurrent()}
      value={selected()}
      onChange={(option) => option && props.onChange(option.value)}
      onInputChange={setSearch}
      onOpenChange={(open) => {
        if (!open) setSearch('');
      }}
      optionValue="value"
      optionTextValue="label"
      // Empty so Kobalte does not seed the search box with the selected zone's
      // text on open — our own trigger shows the selection; the box is for
      // filtering, which still runs on `optionTextValue`.
      optionLabel={() => ''}
      virtualized
      allowsEmptyCollection
      placement="bottom-start"
      gutter={4}
    >
      <Combobox.Control>
        <Combobox.Trigger
          type="button"
          aria-label="Timezone"
          class={cn(
            'flex flex-1 items-center justify-between gap-2 rounded-sm border border-edge-muted bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent',
            props.class
          )}
        >
          <span class="truncate">{triggerLabel()}</span>
          <CaretDownIcon class="size-3 shrink-0 text-ink-muted" />
        </Combobox.Trigger>
      </Combobox.Control>

      <Combobox.Portal>
        <Layer depth={2}>
          <Combobox.Content class="z-action-menu w-[24rem] max-w-[90vw] overflow-hidden rounded-xl border border-edge-muted bg-surface shadow-md">
            <div class="flex items-center gap-2 border-b border-edge-muted px-3 py-2">
              <SearchIcon class="size-3.5 shrink-0 text-ink-muted" />
              <Combobox.Input
                class="min-w-0 flex-1 bg-transparent text-sm caret-accent outline-none placeholder:text-ink-placeholder"
                placeholder="Search timezones..."
              />
            </div>
            <div class="p-1">
              <Show
                when={hasMatches()}
                fallback={
                  <div class="px-2 py-3 text-center text-xs text-ink-muted">
                    No timezones match "{search()}"
                  </div>
                }
              >
                <VirtualizedListbox />
              </Show>
            </div>
          </Combobox.Content>
        </Layer>
      </Combobox.Portal>
    </Combobox>
  );
}
