import { Combobox } from '@kobalte/core/combobox';
import type { CollectionNode } from '@kobalte/core';
import { cn } from '@ui/utils/classname';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  Show,
} from 'solid-js';
import CheckIcon from '@icon/regular/check.svg';
import SearchIcon from '@icon/regular/magnifying-glass.svg';
import type { SearchableOption } from './search-filter-controls';

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

export const SearchableMultiSelect = (props: SearchableMultiSelectProps) => {
  const [internalOpen, setInternalOpen] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal('');

  const isOpen = () => props.open?.() ?? internalOpen();
  const setIsOpen = (v: boolean) => {
    if (props.onOpenChange) props.onOpenChange(v);
    else setInternalOpen(v);
  };

  const activeOptions = createMemo(() => {
    const set = new Set(props.activeIds());
    return props.options().filter((opt) => set.has(opt.id));
  });

  const filteredOptions = createMemo(() => {
    const q = searchQuery().toLowerCase().trim();
    if (!q) return props.options();
    return props.options().filter((opt) => opt.label.toLowerCase().includes(q));
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
      options={filteredOptions()}
      value={activeOptions()}
      onChange={handleChange}
      onInputChange={setSearchQuery}
      onOpenChange={handleOpenChange}
      optionValue="id"
      optionTextValue="label"
      optionLabel="label"
      allowsEmptyCollection
      placement={props.placement ?? 'bottom-start'}
      gutter={props.gutter ?? 4}
      itemComponent={SearchableMultiSelectItem}
    >
      <Combobox.Control class="flex">
        {props.children}
        <Combobox.Input class="sr-only" />
      </Combobox.Control>

      <Combobox.Portal>
        <Combobox.Content
          class={cn(
            'z-action-menu bg-surface-0 border border-edge-muted rounded-sm shadow-md w-[260px] max-w-[90vw] overflow-hidden',
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
              when={filteredOptions().length > 0}
              fallback={
                <div class="py-3 px-2 text-center text-xs text-ink-muted">
                  No options match "{searchQuery()}"
                </div>
              }
            >
              <Combobox.Listbox
                class={cn('max-h-[240px] overflow-y-auto', props.listboxClass)}
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
  isOpen?: Accessor<boolean>;
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

  const activeOptions = createMemo(() => {
    const set = new Set(props.activeIds());
    return props.options().filter((opt) => set.has(opt.id));
  });

  const filteredOptions = createMemo(() => {
    const q = searchQuery().toLowerCase().trim();
    if (!q) return props.options();
    return props.options().filter((opt) => opt.label.toLowerCase().includes(q));
  });

  const handleChange = (selected: SearchableOption[]) => {
    props.onChange(selected.map((o) => o.id));
  };

  createEffect(() => {
    if (props.isOpen && !props.isOpen()) setSearchQuery('');
  });

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
      options={filteredOptions()}
      value={activeOptions()}
      onChange={handleChange}
      onInputChange={setSearchQuery}
      optionValue="id"
      optionTextValue="label"
      optionLabel="label"
      allowsEmptyCollection
      itemComponent={SearchableMultiSelectItem}
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
          when={filteredOptions().length > 0}
          fallback={
            <div class="py-3 px-2 text-center text-xs text-ink-muted">
              No options match "{searchQuery()}"
            </div>
          }
        >
          <Combobox.Listbox
            class={cn('max-h-[240px] overflow-y-auto', props.listboxClass)}
          />
        </Show>
      </div>
    </Combobox>
  );
};
