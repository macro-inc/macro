import { useSelectedFirst } from '@core/util/useSelectedFirst';
import CheckIcon from '@icon/check.svg';
import SearchIcon from '@icon/magnifying-glass.svg';
import type { CollectionNode } from '@kobalte/core';
import { Combobox } from '@kobalte/core/combobox';
import { cn } from '@ui';
import {
  type Accessor,
  createMemo,
  createSignal,
  type JSX,
  Show,
} from 'solid-js';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';
import type { SearchableOption } from './search-filter-controls';

const ITEM_HEIGHT = 36;
const LISTBOX_CLASS = 'max-h-[240px] overflow-y-auto';

export type SearchableMultiSelectProps = {
  options: Accessor<SearchableOption[]>;
  activeIds: Accessor<string[]>;
  onChange: (ids: string[]) => void;
  placeholder?: string;
  placement?:
    | 'bottom-start'
    | 'bottom-end'
    | 'top-start'
    | 'top-end'
    | 'right-start'
    | 'left-start';
  gutter?: number;
  contentClass?: string;
  listboxClass?: string;
  open?: Accessor<boolean>;
  onOpenChange?: (open: boolean) => void;
  children: JSX.Element;
};

const SearchableMultiSelectItem = (itemProps: {
  item: CollectionNode<SearchableOption>;
}) => (
  <Combobox.Item
    item={itemProps.item}
    class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xs text-left text-xs data-highlighted:bg-ink/5 group"
  >
    <span class="size-4 flex items-center justify-center shrink-0 rounded-xs border border-edge group-data-selected:bg-accent group-data-selected:border-accent">
      <Combobox.ItemIndicator>
        <CheckIcon class="size-2.5 text-surface" />
      </Combobox.ItemIndicator>
    </span>
    <Show when={itemProps.item.rawValue.icon}>
      {(icon) => (
        <span class="size-4 flex items-center justify-center shrink-0">
          {icon()()}
        </span>
      )}
    </Show>
    <Combobox.ItemLabel class="flex-1 truncate text-ink-muted group-data-selected:text-ink">
      {itemProps.item.rawValue.label}
    </Combobox.ItemLabel>
  </Combobox.Item>
);

const VirtualizedListbox = (props: {
  options: SearchableOption[];
  class?: string;
}) => {
  let handle: VirtualizerHandle | undefined;
  return (
    <Combobox.Listbox<SearchableOption>
      scrollToItem={(key) => {
        const idx = props.options.findIndex((o) => o.id === key);
        if (idx !== -1) handle?.scrollToIndex(idx, { align: 'nearest' });
      }}
      class={cn(LISTBOX_CLASS, props.class)}
    >
      {(items) => (
        <Virtualizer
          ref={(h) => {
            handle = h;
          }}
          data={[...items()]}
          itemSize={ITEM_HEIGHT}
        >
          {(item) => <SearchableMultiSelectItem item={item} />}
        </Virtualizer>
      )}
    </Combobox.Listbox>
  );
};

/**
 * Tracks whether any option matches the search query. Used to toggle the
 * "no results" message. Precomputes lowercased labels so substring matching
 * on each keystroke isn't O(n) toLowerCase calls.
 */
const useHasMatches = (
  options: Accessor<SearchableOption[]>,
  searchQuery: Accessor<string>
) => {
  const lowered = createMemo(() =>
    options().map((opt) => opt.label.toLowerCase())
  );
  return createMemo(() => {
    const q = searchQuery().trim().toLowerCase();
    if (!q) return options().length > 0;
    return lowered().some((label) => label.includes(q));
  });
};

const useActiveOptions = (
  options: Accessor<SearchableOption[]>,
  activeIds: Accessor<string[]>
) =>
  createMemo(() => {
    const ids = activeIds();
    if (ids.length === 0) return [];
    const set = new Set(ids);
    return options().filter((opt) => set.has(opt.id));
  });

const getOptionId = (opt: SearchableOption) => opt.id;

export const SearchableMultiSelect = (props: SearchableMultiSelectProps) => {
  const [internalOpen, setInternalOpen] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal('');

  const isOpen = () => props.open?.() ?? internalOpen();
  const setIsOpen = (v: boolean) => {
    if (props.onOpenChange) props.onOpenChange(v);
    else setInternalOpen(v);
  };

  const activeOptions = useActiveOptions(props.options, props.activeIds);
  const hasMatches = useHasMatches(props.options, searchQuery);
  const sortedOptions = useSelectedFirst({
    items: props.options,
    selectedIds: props.activeIds,
    searchQuery,
    getId: getOptionId,
    sortDeps: [isOpen],
  });

  const handleChange = (selected: SearchableOption[]) => {
    props.onChange(selected.map((o) => o.id));
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) setSearchQuery('');
  };

  return (
    <Combobox<SearchableOption>
      multiple
      selectionBehavior="toggle"
      closeOnSelection={false}
      open={isOpen()}
      options={sortedOptions()}
      value={activeOptions()}
      onChange={handleChange}
      onInputChange={setSearchQuery}
      onOpenChange={handleOpenChange}
      optionValue="id"
      optionTextValue="label"
      optionLabel="label"
      allowsEmptyCollection
      virtualized
      placement={props.placement ?? 'bottom-start'}
      gutter={props.gutter ?? 4}
    >
      <Combobox.Control class="flex items-center h-full">
        {props.children}
        <Combobox.Input class="sr-only" />
      </Combobox.Control>

      <Combobox.Portal>
        <Combobox.Content
          class={cn(
            'z-action-menu bg-surface border border-edge-muted rounded-sm shadow-md w-65 max-w-[90vw] overflow-hidden',
            props.contentClass
          )}
        >
          <div class="flex items-center gap-2 px-3 py-2 border-b border-edge-muted">
            <SearchIcon class="size-3.5 text-ink-muted shrink-0" />
            <Combobox.Input
              class="flex-1 min-w-0 text-xs bg-transparent outline-none caret-accent placeholder:text-ink-faint"
              placeholder={props.placeholder ?? 'Search...'}
            />
          </div>
          <div class="p-1">
            <Show
              when={hasMatches()}
              fallback={
                <div class="py-3 px-2 text-center text-xs text-ink-muted">
                  {searchQuery().trim()
                    ? `No options match "${searchQuery()}"`
                    : 'No options available'}
                </div>
              }
            >
              <VirtualizedListbox
                options={sortedOptions()}
                class={props.listboxClass}
              />
            </Show>
          </div>
        </Combobox.Content>
      </Combobox.Portal>
    </Combobox>
  );
};

export type SearchableMultiSelectInlineProps = {
  options: Accessor<SearchableOption[]>;
  activeIds: Accessor<string[]>;
  onChange: (ids: string[]) => void;
  placeholder?: string;
  inputRef?: (el: HTMLInputElement) => void;
  onRequestClose?: () => void;
  listboxClass?: string;
};

/**
 * Inline variant — renders Combobox Input + Listbox without a Trigger/Portal.
 * Designed to live inside another popover (e.g. DropdownMenu.SubContent).
 * Stops arrow/enter/character keys from bubbling so the outer menu's
 * keyboard handler doesn't fight Kobalte's built-in combobox navigation.
 */
export const SearchableMultiSelectInline = (
  props: SearchableMultiSelectInlineProps
) => {
  const [searchQuery, setSearchQuery] = createSignal('');

  const activeOptions = useActiveOptions(props.options, props.activeIds);
  const hasMatches = useHasMatches(props.options, searchQuery);
  // Inline variant is freshly mounted each time the parent submenu opens,
  // so we don't need an explicit "menu opened" trigger — the memo's first
  // run captures the current selection ordering.
  const sortedOptions = useSelectedFirst({
    items: props.options,
    selectedIds: props.activeIds,
    searchQuery,
    getId: getOptionId,
  });

  const handleChange = (selected: SearchableOption[]) => {
    props.onChange(selected.map((o) => o.id));
  };

  const handleInputKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowLeft': {
        const input = e.currentTarget as HTMLInputElement;
        // At the start of the input (no caret movement possible), collapse
        // back to the parent menu. Otherwise let the input move the caret.
        if (input.selectionStart === 0 && input.selectionEnd === 0) {
          props.onRequestClose?.();
          return;
        }
        e.stopPropagation();
        return;
      }
      case 'Escape':
        // Let parent close
        return;
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Enter':
      case 'Home':
      case 'End':
      case 'PageUp':
      case 'PageDown':
        e.stopPropagation();
        return;
      default:
        // Character keys, backspace, etc. — Combobox.Input handles them;
        // stop bubbling so the outer menu doesn't run typeahead.
        e.stopPropagation();
    }
  };

  return (
    <Combobox<SearchableOption>
      multiple
      selectionBehavior="toggle"
      closeOnSelection={false}
      open
      options={sortedOptions()}
      value={activeOptions()}
      onChange={handleChange}
      onInputChange={setSearchQuery}
      optionValue="id"
      optionTextValue="label"
      optionLabel="label"
      allowsEmptyCollection
      virtualized
    >
      <div class="flex items-center gap-2 px-3 py-2 border-b border-edge-muted">
        <SearchIcon class="size-3.5 text-ink-muted shrink-0" />
        <Combobox.Input
          ref={props.inputRef}
          onKeyDown={handleInputKeyDown}
          class="flex-1 min-w-0 text-xs bg-transparent outline-none caret-accent placeholder:text-ink-faint"
          placeholder={props.placeholder ?? 'Search...'}
        />
      </div>
      <div class="p-1">
        <Show
          when={hasMatches()}
          fallback={
            <div class="py-3 px-2 text-center text-xs text-ink-muted">
              No options match "{searchQuery()}"
            </div>
          }
        >
          <VirtualizedListbox
            options={sortedOptions()}
            class={props.listboxClass}
          />
        </Show>
      </div>
    </Combobox>
  );
};
