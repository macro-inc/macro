import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useKeyPressed } from '@core/util/useKeyPressed';
import CircleDashedEmpty from '@phosphor/circle-dashed.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import PlusIcon from '@phosphor/plus.svg';
import LoadingSpinner from '@phosphor/spinner.svg';
import { PropertyValueIcon } from '@property/component/propertyValue';
import { useSearchInputFocus } from '@property/utils';
import { ERROR_MESSAGES } from '@property/utils/errorHandling';
import { Hotkey } from '@ui';
import { cn } from '@ui/utils/classname';
import type { JSX, ParentComponent } from 'solid-js';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { OptionCheckBox } from './OptionCheckBox';
import type { OptionSelectorConfig, SelectableOption } from './types';

type UseDropdownSearchOptions = {
  itemCount: Accessor<number>;
  onSelect: (index: number) => void;
  onClose: () => void;
};

const useDropdownSearch = (options: UseDropdownSearchOptions) => {
  const [searchQuery, setSearchQuery] = createSignal('');
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const keyboardMode = useKeyPressed(100);

  createEffect(() => {
    const count = options.itemCount();
    if (count === 0) {
      setSelectedIndex(0);
    } else {
      setSelectedIndex((prev) => Math.min(prev, count - 1));
    }
  });

  const shouldShowHotkeys = () =>
    !searchQuery().trim() && options.itemCount() <= 9;

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      options.onClose();
      return;
    }

    const count = options.itemCount();
    if (count === 0) return;

    if (shouldShowHotkeys() && /^[0-9]$/.test(e.key)) {
      e.preventDefault();
      const keyNum = parseInt(e.key);
      // 0 selects index 0 (the clear option when present)
      // 1-9 select indices 1-9 (the actual options)
      if (keyNum < count) options.onSelect(keyNum);
      return;
    }

    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'j')) {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % count);
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'k')) {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + count) % count);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      options.onSelect(selectedIndex());
    }
  };

  return {
    searchQuery,
    setSearchQuery,
    selectedIndex,
    setSelectedIndex,
    keyboardMode,
    shouldShowHotkeys,
    handleKeyDown,
  };
};

type DropdownSearchInputProps = {
  value: string;
  placeholder: string;
  onInput: (value: string) => void;
  inputType?: string;
  inputRef?: (element: HTMLInputElement) => void;
};

const DropdownSearchInput = (props: DropdownSearchInputProps) => {
  return (
    <div class="flex w-full items-center py-2 gap-2 px-2 border-b border-edge-muted">
      <SearchIcon class="h-4 w-4 text-ink-muted" />
      <input
        class="w-full caret-accent"
        ref={props.inputRef}
        type={props.inputType ?? 'text'}
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        placeholder={props.placeholder}
      />
    </div>
  );
};

type DropdownSelectableRowProps = {
  isSelected: boolean;
  showHotkey?: boolean;
  hotkeyShortcut?: string;
  rightContent?: JSX.Element;
  onClick?: JSX.EventHandlerUnion<HTMLDivElement, MouseEvent>;
  onMouseEnter?: JSX.EventHandlerUnion<HTMLDivElement, MouseEvent>;
};

const DropdownSelectableRow: ParentComponent<DropdownSelectableRowProps> = (
  props
) => {
  return (
    <div
      class="group flex flex-row w-full justify-between items-center gap-2 py-1.5 px-2 rounded-md"
      classList={{
        'bg-hover': props.isSelected,
      }}
      onClick={props.onClick}
      onMouseEnter={props.onMouseEnter}
    >
      <div class="flex items-center gap-2 flex-1 min-w-0">{props.children}</div>
      <div class="flex items-center gap-2 shrink-0">
        <Show when={props.showHotkey && props.hotkeyShortcut}>
          <Hotkey shortcut={props.hotkeyShortcut!} theme="subtle" />
        </Show>
        {props.rightContent}
      </div>
    </div>
  );
};

type SelectOptionsProps = {
  config: OptionSelectorConfig;
  options: SelectableOption[];
  isLoading: boolean;
  error: string | null;
  selectedOptions: () => Set<string>;
  onToggleOption: (value: string) => void;
  onAddOption?: (value: string) => Promise<void>;
  /** When provided, renders a "no value" item at the top of the list. */
  clearOption?: { label: string; onClear: () => void };
  onClose?: () => void;
};

type SelectableItem =
  | { type: 'option'; option: SelectableOption }
  | { type: 'add' }
  | { type: 'clear' };

export const PropertyOptionSelector = (props: SelectOptionsProps) => {
  const [isAddingOption, setIsAddingOption] = createSignal(false);

  let searchInputRef!: HTMLInputElement;

  const isOptionSelected = (value: string) =>
    props.selectedOptions().has(value);

  const handleAddOption = async () => {
    if (!props.onAddOption || !isValidNewOption()) return;

    setIsAddingOption(true);
    try {
      await props.onAddOption(dropdown.searchQuery().trim());
      dropdown.setSearchQuery('');
    } catch (error) {
      console.error(
        'PropertyOptionsList.handleAddOption:',
        error,
        ERROR_MESSAGES.OPTION_ADD
      );
    } finally {
      setIsAddingOption(false);
    }
  };

  const handleSelectableItem = (idx: number) => {
    const item = selectableItems()[idx];
    if (item?.type === 'add') {
      handleAddOption();
    } else if (item?.type === 'clear') {
      props.clearOption?.onClear();
      if (!props.config.isMultiSelect && props.onClose) {
        props.onClose();
      }
    } else if (item?.type === 'option') {
      props.onToggleOption(item.option.id);
      if (!props.config.isMultiSelect && props.onClose) {
        props.onClose();
      }
    }
  };

  const dropdown = useDropdownSearch({
    itemCount: () => selectableItems().length,
    onSelect: handleSelectableItem,
    onClose: () => {
      if (props.onClose) props.onClose();
    },
  });

  const hasExactMatch = createMemo(() => {
    const query = dropdown.searchQuery().trim();
    if (!query) return false;

    return props.options.some((option) => option.label === query);
  });

  const isValidNewOption = createMemo(() => {
    const query = dropdown.searchQuery().trim();

    if (!query) return false;

    if (hasExactMatch()) return false;

    return props.config.canAddOption?.(query) ?? false;
  });

  // Filter options based on search query and sort selected first, then alphabetically
  const filteredOptions = createMemo(() => {
    const query = dropdown.searchQuery().toLowerCase().trim();
    const selectedIds = props.selectedOptions();

    const availableOptions = !query
      ? props.options
      : props.options.filter((option) => {
          return option.label.toLowerCase().includes(query);
        });

    // Only include missing selected options when there's no search query
    let allOptions = availableOptions;
    if (!query) {
      const availableOptionIds = new Set(availableOptions.map((opt) => opt.id));
      const missingSelectedOptions: SelectableOption[] = [];

      for (const selectedId of selectedIds) {
        if (!availableOptionIds.has(selectedId)) {
          const actualOption = props.options.find(
            (opt) => opt.id === selectedId
          );
          if (actualOption) {
            missingSelectedOptions.push(actualOption);
          }
        }
      }

      allOptions = [...missingSelectedOptions, ...availableOptions];
    }

    return allOptions;
  });

  // Only show the clear item when the user isn't searching — searching by name
  // matches the option list, not the synthetic "no value" entry.
  const showClearItem = () =>
    !!props.clearOption && !dropdown.searchQuery().trim();

  // Hide search on touch device, makes using the menus awkward
  const showSearchInput = () => !isTouchDevice();

  // Get selectable items: optional clear + filtered options + optional add.
  const selectableItems = createMemo(() => {
    const items: SelectableItem[] = [];

    if (showClearItem()) {
      items.push({ type: 'clear' });
    }

    for (const option of filteredOptions()) {
      items.push({ type: 'option', option });
    }

    if (isValidNewOption() && props.onAddOption) {
      items.push({ type: 'add' });
    }

    return items;
  });

  onMount(() => {
    document.addEventListener('keydown', dropdown.handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener('keydown', dropdown.handleKeyDown);
  });

  useSearchInputFocus(
    () => searchInputRef,
    () => !props.isLoading && !props.error
  );

  const AddOptionButton = (props: { isSelected: boolean }) => (
    <div
      onClick={handleAddOption}
      class={cn(
        'flex flex-row w-full justify-between items-center gap-2 py-1.5 px-2',
        props.isSelected && 'bg-hover'
      )}
    >
      <div class="flex items-center gap-2 flex-1 text-left">
        <div class="size-3 shrink-0">
          <Show
            when={!isAddingOption()}
            fallback={
              <div class="size-3 animate-spin">
                <LoadingSpinner />
              </div>
            }
          >
            <PlusIcon class="size-3" />
          </Show>
        </div>
        <p>Add "{dropdown.searchQuery().trim()}"</p>
      </div>
    </div>
  );

  return (
    <Show
      when={!props.isLoading}
      fallback={
        <div class="flex items-center justify-center py-8">
          <div class="w-5 h-5 animate-spin">
            <LoadingSpinner />
          </div>
          <span class="ml-2 text-ink-muted">Loading options...</span>
        </div>
      }
    >
      <Show when={!props.error}>
        <div>
          <Show when={showSearchInput()}>
            <div class="relative">
              <DropdownSearchInput
                value={dropdown.searchQuery()}
                inputRef={(element) => {
                  searchInputRef = element;
                }}
                inputType={props.config.inputType ?? 'text'}
                onInput={dropdown.setSearchQuery}
                placeholder={props.config.placeholder}
              />
            </div>
          </Show>

          <Show
            when={props.options.length > 0}
            fallback={
              <div class="space-y-3">
                <Show
                  when={isValidNewOption() && props.onAddOption}
                  fallback={
                    <div class="text-center py-6 text-ink-muted">
                      No options available
                    </div>
                  }
                >
                  <div class="p-1">
                    <AddOptionButton
                      isSelected={
                        dropdown.selectedIndex() === filteredOptions().length
                      }
                    />
                  </div>
                </Show>
              </div>
            }
          >
            <div class="p-1.5">
              <div class="max-h-50 overflow-y-auto overflow-x-hidden scrollbar-hidden">
                <Show
                  when={selectableItems().length > 0}
                  fallback={
                    <div class="text-center py-4 text-ink-muted">
                      No options match your search
                    </div>
                  }
                >
                  <For each={selectableItems()}>
                    {(item, index) => {
                      const isSelected = () =>
                        index() === dropdown.selectedIndex();
                      const onMouseEnter = () => {
                        if (!dropdown.keyboardMode()) {
                          dropdown.setSelectedIndex(index());
                        }
                      };
                      return (
                        <Switch>
                          <Match when={item.type === 'option' ? item : false}>
                            {(optionItem) => (
                              <DropdownSelectableRow
                                isSelected={isSelected()}
                                onClick={() => {
                                  props.onToggleOption(optionItem().option.id);
                                  if (
                                    !props.config.isMultiSelect &&
                                    props.onClose
                                  ) {
                                    props.onClose();
                                  }
                                }}
                                onMouseEnter={onMouseEnter}
                                showHotkey={
                                  dropdown.shouldShowHotkeys() && index() <= 9
                                }
                                hotkeyShortcut={`${index()}`}
                                rightContent={
                                  <Show when={props.config.isMultiSelect}>
                                    <OptionCheckBox
                                      checked={isOptionSelected(
                                        optionItem().option.id
                                      )}
                                      multiselect={props.config.isMultiSelect}
                                    />
                                  </Show>
                                }
                              >
                                <PropertyValueIcon
                                  optionId={optionItem().option.id}
                                />
                                <div class="flex-1 min-w-0 text-left">
                                  <p class="truncate">
                                    {optionItem().option.label}
                                  </p>
                                </div>
                              </DropdownSelectableRow>
                            )}
                          </Match>
                          <Match
                            when={item.type === 'clear' && props.clearOption}
                          >
                            {(clear) => (
                              <DropdownSelectableRow
                                isSelected={isSelected()}
                                onClick={() => {
                                  clear().onClear();
                                  if (
                                    !props.config.isMultiSelect &&
                                    props.onClose
                                  ) {
                                    props.onClose();
                                  }
                                }}
                                onMouseEnter={onMouseEnter}
                                showHotkey={dropdown.shouldShowHotkeys()}
                                hotkeyShortcut="0"
                              >
                                <CircleDashedEmpty class="size-3 shrink-0 text-ink-extra-muted" />
                                <div class="flex-1 min-w-0 text-left">
                                  <p class="text-ink-muted truncate">
                                    {clear().label}
                                  </p>
                                </div>
                              </DropdownSelectableRow>
                            )}
                          </Match>
                          <Match when={item.type === 'add'}>
                            <div onMouseEnter={onMouseEnter}>
                              <AddOptionButton isSelected={isSelected()} />
                            </div>
                          </Match>
                        </Switch>
                      );
                    }}
                  </For>
                </Show>
              </div>
            </div>
          </Show>
        </div>
      </Show>
    </Show>
  );
};
