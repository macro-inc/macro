import { Hotkey } from '@core/component/Hotkey';
import SearchIcon from '@icon/regular/magnifying-glass.svg';
import PlusIcon from '@icon/regular/plus.svg';
import LoadingSpinner from '@icon/regular/spinner.svg';
import type * as schemas from '@service-properties/generated/zod';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import type { z } from 'zod';
import type { Property } from '../../../types';
import { formatOptionValue, useSearchInputFocus } from '../../../utils';
import { ERROR_MESSAGES } from '../../../utils/errorHandling';
import { PropertyValueIcon } from '../../propertyValue';
import { OptionCheckBox } from './OptionCheckBox';

type PropertyOption = z.infer<typeof schemas.getPropertyOptionsResponseItem>;

type SelectOptionsProps = {
  property: Property;
  options: PropertyOption[];
  isLoading: boolean;
  error: string | null;
  selectedOptions: () => Set<string>;
  onToggleOption: (value: string) => void;
  onAddOption?: (value: string) => Promise<void>;
  onClose?: () => void;
};

export const PropertyOptionSelector = (props: SelectOptionsProps) => {
  const [searchQuery, setSearchQuery] = createSignal('');
  const [isAddingOption, setIsAddingOption] = createSignal(false);
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [keyboardNavigationTimeout, setKeyboardNavigationTimeout] =
    createSignal<number | null>(null);

  let searchInputRef!: HTMLInputElement;

  const isOptionSelected = (value: string) =>
    props.selectedOptions().has(value);

  const hasExactMatch = createMemo(() => {
    const query = searchQuery().trim();
    if (!query) return false;

    return props.options.some((option) => {
      const displayValue = formatOptionValue(option);
      return displayValue === query;
    });
  });

  const isValidNewOption = createMemo(() => {
    const query = searchQuery().trim();

    if (!query) return false;

    if (hasExactMatch()) return false;

    if (props.property.valueType === 'SELECT_STRING') {
      return true;
    }

    if (props.property.valueType === 'SELECT_NUMBER') {
      const num = parseFloat(query);
      return !isNaN(num) && Number.isFinite(num);
    }

    return false;
  });

  const handleAddOption = async () => {
    if (!props.onAddOption || !isValidNewOption()) return;

    setIsAddingOption(true);
    try {
      await props.onAddOption(searchQuery().trim());
      setSearchQuery('');
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

  // Filter options based on search query and sort selected first, then alphabetically
  const filteredOptions = createMemo(() => {
    const query = searchQuery().toLowerCase().trim();
    const selectedIds = props.selectedOptions();

    const availableOptions = !query
      ? props.options
      : props.options.filter((option) => {
          const displayValue = formatOptionValue(option).toLowerCase();
          return displayValue.includes(query);
        });

    // Only include missing selected options when there's no search query
    let allOptions = availableOptions;
    if (!query) {
      const availableOptionIds = new Set(availableOptions.map((opt) => opt.id));
      const missingSelectedOptions: PropertyOption[] = [];

      for (const selectedId of selectedIds) {
        if (!availableOptionIds.has(selectedId)) {
          // Find the actual option from props.options to get its value
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

  // Get selectable items (filtered options + add option if available)
  const selectableItems = createMemo(() => {
    const options = filteredOptions();
    const items: Array<{ type: 'option' | 'add'; option?: PropertyOption }> =
      [];

    options.forEach((option) => {
      items.push({ type: 'option', option });
    });

    if (isValidNewOption() && props.onAddOption) {
      items.push({ type: 'add' });
    }

    return items;
  });

  // Reset selected index when filteredOptions change
  createEffect(() => {
    const items = selectableItems();
    if (items.length === 0) {
      setSelectedIndex(0);
    } else {
      setSelectedIndex(Math.min(selectedIndex(), items.length - 1));
    }
  });

  const isKeyboardNavigating = () => {
    const timeout = keyboardNavigationTimeout();
    return timeout !== null && Date.now() - timeout < 150;
  };

  const shouldShowHotkeys = createMemo(() => {
    return !searchQuery().trim() && selectableItems().length <= 9;
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    const items = selectableItems();
    if (items.length === 0) return;

    // Handle number keys (1-9) when no search term and 9 or fewer options
    if (shouldShowHotkeys() && /^[1-9]$/.test(e.key)) {
      e.preventDefault();
      const index = parseInt(e.key) - 1;
      if (index < items.length) {
        const selectedItem = items[index];
        if (selectedItem?.type === 'add') {
          handleAddOption();
        } else if (selectedItem?.type === 'option' && selectedItem.option) {
          props.onToggleOption(selectedItem.option.id);

          // If not multi-select, close the modal after selection
          if (!props.property.isMultiSelect && props.onClose) {
            props.onClose();
          }
        }
      }
      return;
    }

    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'j')) {
      e.preventDefault();
      setKeyboardNavigationTimeout(Date.now());
      setSelectedIndex((prev) => (prev + 1) % items.length);
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'k')) {
      e.preventDefault();
      setKeyboardNavigationTimeout(Date.now());
      setSelectedIndex((prev) => (prev - 1 + items.length) % items.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selectedItem = items[selectedIndex()];

      if (selectedItem?.type === 'add') {
        handleAddOption();
      } else if (selectedItem?.type === 'option' && selectedItem.option) {
        props.onToggleOption(selectedItem.option.id);

        // If not multi-select, close the modal after selection
        if (!props.property.isMultiSelect && props.onClose) {
          props.onClose();
        }
      }
    }
  };

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown);
  });

  useSearchInputFocus(
    () => searchInputRef,
    () => !props.isLoading && !props.error
  );

  const AddOptionButton = (props: {
    isSelected: boolean;
    hotkeyNumber?: number;
  }) => (
    <div
      onClick={handleAddOption}
      class={`flex flex-row w-full justify-between items-center gap-2 py-1.5 px-2 ${
        props.isSelected ? 'bg-hover' : ''
      }`}
    >
      <div class="flex items-center gap-2 flex-1 text-left">
        <div class="size-3 flex-shrink-0">
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
        <p class="text-sm font-medium">Add "{searchQuery().trim()}"</p>
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
          <div class="relative">
            <div class="flex w-full items-center py-1 gap-2 px-2 border-b border-edge-muted">
              <SearchIcon class="h-4 w-4 text-ink-muted" />
              <input
                class="w-full caret-accent"
                ref={searchInputRef}
                type={
                  props.property.valueType === 'SELECT_NUMBER'
                    ? 'number'
                    : 'text'
                }
                value={searchQuery()}
                onInput={(e) => setSearchQuery(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (props.onClose) {
                      props.onClose();
                    }
                  }
                }}
                placeholder={`${props.property.isMultiSelect ? 'Add' : 'Change'} ${props.property.displayName.toLowerCase()}...`}
              />
            </div>
          </div>

          <Show
            when={props.options.length > 0}
            fallback={
              <div class="space-y-3">
                <Show
                  when={isValidNewOption() && props.onAddOption}
                  fallback={
                    <div class="text-center py-6 text-ink-muted text-sm">
                      No options available
                    </div>
                  }
                >
                  <div class="p-1">
                    <AddOptionButton
                      isSelected={selectedIndex() === filteredOptions().length}
                    />
                  </div>
                </Show>
              </div>
            }
          >
            <div class="p-1">
              <div class="max-h-[200px] overflow-y-auto overflow-x-hidden scrollbar-hidden">
                <Show
                  when={selectableItems().length > 0}
                  fallback={
                    <div class="text-center py-4 text-ink-muted text-sm">
                      No options match your search
                    </div>
                  }
                >
                  <For each={selectableItems()}>
                    {(item, index) => (
                      <Show
                        when={item.type === 'add'}
                        fallback={
                          <div
                            class={`flex flex-row w-full justify-between items-center gap-2 py-1.5 px-2 ${
                              index() === selectedIndex() ? 'bg-hover' : ''
                            }`}
                            onClick={() => {
                              if (item.option) {
                                props.onToggleOption(item.option.id);
                                // If not multi-select, close the modal after selection
                                if (
                                  !props.property.isMultiSelect &&
                                  props.onClose
                                ) {
                                  props.onClose();
                                }
                              }
                            }}
                            onMouseEnter={() => {
                              if (!isKeyboardNavigating()) {
                                setSelectedIndex(index());
                              }
                            }}
                          >
                            <PropertyValueIcon optionId={item.option!.id} />
                            <div class="flex-1 text-left">
                              <p class="text-sm font-medium">
                                {formatOptionValue(item.option!)}
                              </p>
                            </div>
                            <div class="flex items-center gap-2 flex-shrink-0">
                              <Show when={shouldShowHotkeys() && index() < 9}>
                                <div class="text-[0.625rem] px-1.5 py-0.5 border border-edge-muted text-ink-muted font-mono rounded-xs">
                                  <Hotkey shortcut={`${index() + 1}`} />
                                </div>
                              </Show>
                              <Show when={props.property.isMultiSelect}>
                                <OptionCheckBox
                                  checked={isOptionSelected(item.option!.id)}
                                  multiselect={props.property.isMultiSelect}
                                />
                              </Show>
                            </div>
                          </div>
                        }
                      >
                        <div
                          onMouseEnter={() => {
                            if (!isKeyboardNavigating()) {
                              setSelectedIndex(index());
                            }
                          }}
                        >
                          <AddOptionButton
                            isSelected={index() === selectedIndex()}
                          />
                        </div>
                      </Show>
                    )}
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
