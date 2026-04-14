import ChevronDownIcon from '@icon/regular/caret-down.svg';
import CheckIcon from '@icon/regular/check.svg';
import SearchIcon from '@icon/regular/magnifying-glass.svg';
import { Combobox } from '@kobalte/core/combobox';
import { Select as KSelect } from '@kobalte/core/select';
import { cn } from '@ui/utils/classname';
import { Button } from '@app/component/next-soup/soup-view/filters-bar/button';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';
import type { CollectionNode } from '@kobalte/core';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';

export type Option = {
  value: string;
  label: string;
  icon?: () => JSX.Element;
};

interface FilterSelectProps {
  label: string;
  options: Option[];
  active: Option[];
  onChange: (options: Option[]) => void;
  multiple?: boolean;
}

export const FilterSelect = (props: FilterSelectProps) => {
  const multiple = () => props.multiple ?? true;

  const activeFilters = createMemo(() => props.active);
  const activeCount = createMemo(() => activeFilters().length);
  const hasActiveFilters = createMemo(() => activeCount() > 0);

  const renderItem = (itemProps: { item: CollectionNode<Option> }) => (
    <KSelect.Item
      item={itemProps.item}
      class="w-full flex items-center gap-2.5 p-2 rounded-xs text-left text-xs hover:bg-ink/5 group"
    >
      <span
        class={cn(
          'size-4 flex items-center justify-center shrink-0 border border-edge-muted group-data-[selected]:bg-accent group-data-[selected]:border-accent',
          multiple() ? 'rounded-xs' : 'rounded-full'
        )}
      >
        <KSelect.ItemIndicator>
          <CheckIcon class="size-2.5 text-page" />
        </KSelect.ItemIndicator>
      </span>

      <Show when={itemProps.item.rawValue.icon}>
        {(icon) => (
          <span class="size-4 flex items-center justify-center shrink-0">
            {icon()()}
          </span>
        )}
      </Show>

      <KSelect.ItemLabel class="flex-1 truncate text-ink-muted group-data-[selected]:text-ink">
        {itemProps.item.rawValue.label}
      </KSelect.ItemLabel>
    </KSelect.Item>
  );

  // For single select: convert to/from array format
  const value = () =>
    multiple() ? activeFilters() : (activeFilters()[0] ?? null);
  const handleChange = (selected: Option | Option[] | null) => {
    if (multiple()) {
      props.onChange(selected as Option[]);
    } else {
      if (!selected) return;
      props.onChange([selected as Option]);
    }
  };

  return (
    <KSelect<Option>
      options={props.options}
      value={value() as Option & Option[]}
      onChange={handleChange as (value: Option & Option[]) => void}
      optionTextValue="label"
      optionValue="value"
      gutter={4}
      multiple={multiple()}
      placement="bottom-start"
      itemComponent={renderItem}
    >
      <KSelect.Trigger
        as={Button}
        variant="secondary"
        size="sm"
        class={cn(
          'relative transition-none rounded-xs h-full',
          hasActiveFilters() &&
            'bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25'
        )}
      >
        <span class="font-medium">{props.label}</span>
        <Show when={multiple() && hasActiveFilters()}>
          <span class="absolute -top-2 -right-2 flex items-center justify-center size-4 z-1 rounded-full text-xs font-semibold bg-accent text-page">
            {activeCount()}
          </span>
        </Show>
        <ChevronDownIcon class="size-3" />
      </KSelect.Trigger>
      <KSelect.Portal>
        <KSelect.Content class="z-action-menu bg-surface-0 border border-edge-muted rounded-sm shadow min-w-[var(--kb-popper-anchor-width)] p-1">
          <KSelect.Listbox />
          <div class="w-full pt-1 mt-1 flex items-center border-t border-t-edge-muted">
            <Button
              variant="ghost"
              size="sm"
              class="ml-auto rounded-xs w-full"
              onClick={() => props.onChange([])}
            >
              Clear
            </Button>
          </div>
        </KSelect.Content>
      </KSelect.Portal>
    </KSelect>
  );
};

interface FilterComboboxProps {
  label: string;
  options: Option[];
  active: Option[];
  onChange: (options: Option[]) => void;
  placeholder?: string;
  virtualized?: boolean;
  estimatedItemHeight?: number;
}

const COMBOBOX_ITEM_HEIGHT = 36;

const ComboboxItem = (itemProps: { item: CollectionNode<Option> }) => (
  <Combobox.Item
    item={itemProps.item}
    class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xs text-left text-xs data-[highlighted]:bg-ink/5 group"
  >
    <span class="size-4 flex items-center justify-center shrink-0 rounded-xs border border-edge group-data-[selected]:bg-accent group-data-[selected]:border-accent">
      <Combobox.ItemIndicator>
        <CheckIcon class="size-2.5 text-page" />
      </Combobox.ItemIndicator>
    </span>

    <Show when={itemProps.item.rawValue.icon}>
      {(icon) => (
        <span class="size-4 flex items-center justify-center shrink-0">
          {icon()()}
        </span>
      )}
    </Show>

    <Combobox.ItemLabel class="flex-1 truncate text-ink-muted group-data-[selected]:text-ink">
      {itemProps.item.rawValue.label}
    </Combobox.ItemLabel>
  </Combobox.Item>
);

interface VirtualizedListboxProps {
  options: Option[];
  estimatedItemHeight: number;
  setListboxRef: (el: HTMLElement | undefined) => void;
}

const VirtualizedListbox = (props: VirtualizedListboxProps) => {
  let virtualizerHandle: VirtualizerHandle | undefined;

  return (
    <Combobox.Listbox<Option>
      ref={props.setListboxRef}
      scrollToItem={(key) => {
        const index = props.options.findIndex((opt) => opt.value === key);
        if (index !== -1) {
          virtualizerHandle?.scrollToIndex(index, { align: 'nearest' });
        }
      }}
      class="max-h-[200px] overflow-y-auto"
    >
      {(items) => (
        <Virtualizer
          ref={(handle) => {
            virtualizerHandle = handle;
          }}
          data={[...items()]}
          itemSize={props.estimatedItemHeight}
        >
          {(item) => <ComboboxItem item={item} />}
        </Virtualizer>
      )}
    </Combobox.Listbox>
  );
};

export const FilterCombobox = (props: FilterComboboxProps) => {
  const [searchQuery, setSearchQuery] = createSignal('');
  const [listboxRef, setListboxRef] = createSignal<HTMLElement | undefined>();

  const virtualized = () => props.virtualized ?? false;
  const estimatedItemHeight = () =>
    props.estimatedItemHeight ?? COMBOBOX_ITEM_HEIGHT;

  const activeFilters = createMemo(() => props.active);
  const activeCount = createMemo(() => activeFilters().length);
  const hasActiveFilters = createMemo(() => activeCount() > 0);

  const filteredOptions = createMemo(() => {
    const query = searchQuery().toLowerCase().trim();
    if (!query) return props.options;
    return props.options.filter((opt) =>
      opt.label.toLowerCase().includes(query)
    );
  });

  const dispatchKeyToListbox = (key: string) => {
    listboxRef()?.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key })
    );
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'j': {
        if (!e.ctrlKey) return;
        e.preventDefault();
        dispatchKeyToListbox('ArrowDown');
        break;
      }
      case 'k': {
        if (!e.ctrlKey) return;
        e.preventDefault();
        dispatchKeyToListbox('ArrowUp');
        break;
      }
    }
  };

  const onInputChange = (value: string) => {
    setSearchQuery(value);
    queueMicrotask(() => {
      dispatchKeyToListbox('ArrowDown');
    });
  };

  const onOpenChange = (open: boolean) => {
    if (!open) {
      setSearchQuery('');
    }
  };

  return (
    <Combobox<Option>
      class="max-h-full"
      multiple
      options={filteredOptions()}
      value={activeFilters()}
      onChange={props.onChange}
      onOpenChange={onOpenChange}
      onInputChange={onInputChange}
      optionValue="value"
      optionTextValue="label"
      optionLabel="label"
      allowsEmptyCollection
      placement="bottom-start"
      gutter={4}
      virtualized={virtualized()}
      itemComponent={virtualized() ? undefined : ComboboxItem}
    >
      <Combobox.Control class="flex h-full">
        <Combobox.Trigger
          as={Button}
          variant="secondary"
          size="sm"
          class={cn(
            'relative transition-none rounded-xs h-full',
            hasActiveFilters() &&
              'bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25'
          )}
        >
          <span class="font-medium">{props.label}</span>
          <Show when={hasActiveFilters()}>
            <span class="absolute -top-2 -right-2 flex items-center justify-center size-4 z-1 rounded-full text-xs font-semibold bg-accent text-page">
              {activeCount()}
            </span>
          </Show>
          <ChevronDownIcon class="size-3" />
        </Combobox.Trigger>
        <Combobox.Input class="sr-only" />
      </Combobox.Control>

      <Combobox.Portal>
        <Combobox.Content
          class="z-action-menu bg-surface-0 border border-edge-muted rounded-sm shadow-md min-w-[220px] overflow-hidden"
          on:keydown={handleKeyDown}
        >
          <div class="flex items-center gap-2 px-3 py-2 border-b border-edge-muted">
            <SearchIcon class="size-3.5 text-ink-muted shrink-0" />
            <Combobox.Input
              class="flex-1 text-xs bg-transparent outline-none caret-accent placeholder:text-ink-faint"
              placeholder={
                props.placeholder ?? `Search ${props.label.toLowerCase()}...`
              }
            />
          </div>

          <div class="p-1">
            <Show
              when={filteredOptions().length > 0}
              fallback={
                <div class="py-3 px-2 text-center text-xs text-ink-muted whitespace-break-spaces break-words">
                  No options match "{searchQuery()}"
                </div>
              }
            >
              <Show
                when={virtualized()}
                fallback={
                  <Combobox.Listbox
                    ref={setListboxRef}
                    class="max-h-[200px] overflow-y-auto"
                  />
                }
              >
                <VirtualizedListbox
                  options={filteredOptions()}
                  estimatedItemHeight={estimatedItemHeight()}
                  setListboxRef={setListboxRef}
                />
              </Show>
            </Show>
          </div>

          <Show when={hasActiveFilters()}>
            <div class="w-full pt-1 px-1 pb-1 flex items-center border-t border-t-edge-muted">
              <Button
                variant="ghost"
                size="sm"
                class="ml-auto rounded-xs w-full"
                onClick={() => props.onChange([])}
              >
                Clear
              </Button>
            </div>
          </Show>
        </Combobox.Content>
      </Combobox.Portal>
    </Combobox>
  );
};

interface FilterChipGroupProps {
  options: Option[];
  active: Option[];
  onChange: (options: Option[]) => void;
  multiple?: boolean;
}

export const FilterChipGroup = (props: FilterChipGroupProps) => {
  const multiple = () => props.multiple ?? true;

  const activeSet = createMemo(() => new Set(props.active.map((o) => o.value)));

  const isActive = (value: string) => activeSet().has(value);

  const handleClick = (option: Option) => {
    const currentlyActive = isActive(option.value);

    if (!multiple()) {
      props.onChange(currentlyActive ? [] : [option]);
      return;
    }

    if (currentlyActive) {
      props.onChange(props.active.filter((o) => o.value !== option.value));
    } else {
      props.onChange([...props.active, option]);
    }
  };

  return (
    <div class="flex items-center gap-1 flex-wrap">
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            class={cn(
              'flex items-center gap-1.5 px-3 py-1 text-xs rounded-xs h-full border',
              isActive(option.value)
                ? 'bg-accent/6 text-accent border-accent/30 hover:bg-accent/25'
                : 'bg-ink/3 text-ink border-edge-muted/50 hover:bg-ink/12 hover:text-ink'
            )}
            onClick={() => handleClick(option)}
          >
            <Show
              when={option.icon}
              fallback={
                <Show when={isActive(option.value)}>
                  <CheckIcon class="size-3.5 shrink-0" />
                </Show>
              }
            >
              {(icon) => (
                <span class="size-3.5 flex items-center justify-center shrink-0">
                  <Show when={isActive(option.value)} fallback={icon()()}>
                    <CheckIcon class="size-3.5" />
                  </Show>
                </span>
              )}
            </Show>
            <span class="font-medium">{option.label}</span>
          </button>
        )}
      </For>
    </div>
  );
};
