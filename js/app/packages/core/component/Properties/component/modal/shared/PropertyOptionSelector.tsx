import CheckIcon from '@icon/bold/check-bold.svg';
import SearchIcon from '@icon/regular/magnifying-glass.svg';
import PlusIcon from '@icon/regular/plus.svg';
import LoadingSpinner from '@icon/regular/spinner.svg';
import type * as schemas from '@service-properties/generated/zod';
import { createMemo, createSignal, For, Show } from 'solid-js';
import type { z } from 'zod';
import { PROPERTY_STYLES } from '../../../styles/styles';
import type { Property } from '../../../types';
import { formatOptionValue, useSearchInputFocus } from '../../../utils';
import { ERROR_MESSAGES } from '../../../utils/errorHandling';

type PropertyOption = z.infer<typeof schemas.getPropertyOptionsResponseItem>;

type SelectOptionsProps = {
  property: Property;
  options: PropertyOption[];
  isLoading: boolean;
  error: string | null;
  selectedOptions: () => Set<string>;
  onToggleOption: (value: string) => void;
  onRetry: () => void;
  onAddOption?: (value: string) => Promise<void>;
};

const ADD_OPTION_BASE_CLASSES =
  'flex flex-row w-full justify-between items-center gap-4 cursor-pointer p-2 border border-dashed border-accent/50 hover:border-accent hover:bg-accent/5 text-accent';

export const PropertyOptionSelector = (props: SelectOptionsProps) => {
  const [searchQuery, setSearchQuery] = createSignal('');
  const [isAddingOption, setIsAddingOption] = createSignal(false);

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

  useSearchInputFocus(
    () => searchInputRef,
    () => !props.isLoading && !props.error
  );

  const AddOptionButton = () => (
    <div
      class={`${ADD_OPTION_BASE_CLASSES} ${
        isAddingOption() ? 'opacity-50 pointer-events-none' : ''
      }`}
      onClick={handleAddOption}
    >
      <div class="flex items-center gap-2 flex-1 text-left">
        <div class="w-4 h-4 flex-shrink-0">
          <Show
            when={!isAddingOption()}
            fallback={
              <div class="w-4 h-4 animate-spin">
                <LoadingSpinner />
              </div>
            }
          >
            <PlusIcon class="w-4 h-4" />
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
      <Show
        when={!props.error}
        fallback={
          <div class="text-center py-6">
            <div class="text-failure-ink mb-3 text-sm">{props.error}</div>
            <button
              onClick={props.onRetry}
              class="px-3 py-1.5 bg-accent text-ink text-sm hover:bg-accent/90"
            >
              Retry
            </button>
          </div>
        }
      >
        <div class="space-y-3">
          <div class="relative">
            <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none z-10">
              <SearchIcon class="h-4 w-4 text-ink-muted" />
            </div>
            <input
              ref={searchInputRef}
              type={
                props.property.valueType === 'SELECT_NUMBER' ? 'number' : 'text'
              }
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
              placeholder={
                props.property.valueType === 'SELECT_NUMBER'
                  ? 'Search or add new number...'
                  : 'Search or add new option...'
              }
              class={`${PROPERTY_STYLES.input.search} relative z-0`}
            />
          </div>

          <Show
            when={props.options.length > 0}
            fallback={
              <div class="space-y-3">
                <Show when={isValidNewOption() && props.onAddOption}>
                  <AddOptionButton />
                </Show>
                <Show when={!isValidNewOption()}>
                  <div class="text-center py-6 text-ink-muted text-sm">
                    No options available
                  </div>
                </Show>
              </div>
            }
          >
            <div class="space-y-2 max-h-48 overflow-y-auto">
              <Show when={isValidNewOption() && props.onAddOption}>
                <AddOptionButton />
              </Show>

              <Show
                when={filteredOptions().length > 0}
                fallback={
                  <Show when={!isValidNewOption()}>
                    <div class="text-center py-4 text-ink-muted text-sm">
                      No options match your search
                    </div>
                  </Show>
                }
              >
                <For each={filteredOptions()}>
                  {(option) => {
                    const optionId = option.id;
                    const displayValue = formatOptionValue(option);

                    return (
                      <div
                        class={`flex flex-row w-full justify-between items-center gap-4 cursor-pointer py-1.5 px-2 border ${isOptionSelected(optionId) ? 'bg-active border-accent text-accent-ink' : 'hover:bg-hover border-edge text-ink'}`}
                        onClick={() => props.onToggleOption(optionId)}
                      >
                        <div class="flex-1 text-left">
                          <p class="text-sm font-medium">{displayValue}</p>
                        </div>
                        <div class="flex-shrink-0">
                          <div class="w-4 h-4 border border-edge bg-transparent flex items-center justify-center">
                            <Show when={isOptionSelected(optionId)}>
                              <CheckIcon class="w-3 h-3 text-accent" />
                            </Show>
                          </div>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </Show>
  );
};
