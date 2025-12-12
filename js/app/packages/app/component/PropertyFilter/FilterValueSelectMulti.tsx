import { zSidePanelSearchAndFilter } from '@core/constant/stackingContext';
import { isErr } from '@core/util/maybeResult';
import XIcon from '@phosphor-icons/core/assets/regular/x.svg';
import { propertiesServiceClient } from '@service-properties/client';
import type { PropertyOption } from '@service-properties/generated/schemas/propertyOption';
import type { Component } from 'solid-js';
import {
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';

export type FilterValueSelectMultiProps = {
  propertyId: string;
  dataType: 'SELECT_STRING' | 'SELECT_NUMBER';
  values: string[]; // Array of option IDs
  onChange: (values: string[]) => void;
};

export const FilterValueSelectMulti: Component<FilterValueSelectMultiProps> = (
  props
) => {
  const [isAdding, setIsAdding] = createSignal(false);
  const [options, setOptions] = createSignal<PropertyOption[]>([]);
  const [isLoading, setIsLoading] = createSignal(true);
  const [searchQuery, setSearchQuery] = createSignal('');

  let inputRef!: HTMLInputElement;
  let containerRef!: HTMLDivElement;
  let dropdownRef!: HTMLDivElement;

  // Fetch options for this property
  const fetchOptions = async () => {
    setIsLoading(true);
    try {
      const result = await propertiesServiceClient.getPropertyOptions({
        definition_id: props.propertyId,
      });

      if (isErr(result)) {
        setOptions([]);
        return;
      }

      const [, data] = result;
      setOptions(Array.isArray(data) ? data : []);
    } catch (_error) {
      setOptions([]);
    } finally {
      setIsLoading(false);
    }
  };

  onMount(() => {
    fetchOptions();
  });

  // Get display value for an option
  const getOptionDisplayValue = (option: PropertyOption): string => {
    if (option.value.type === 'string') {
      return option.value.value;
    }
    return String(option.value.value);
  };

  // Get option by ID
  const getOptionById = (id: string): PropertyOption | undefined => {
    return options().find((o) => o.id === id);
  };

  // Get available options (not already selected, filtered by search)
  const availableOptions = createMemo(() => {
    const query = searchQuery().toLowerCase().trim();
    return options()
      .filter((o) => !props.values.includes(o.id))
      .filter((o) => {
        if (!query) return true;
        return getOptionDisplayValue(o).toLowerCase().includes(query);
      });
  });

  const handleAddClick = () => {
    setIsAdding(true);
    setSearchQuery('');
    setTimeout(() => inputRef?.focus(), 0);
  };

  const handleSelectOption = (option: PropertyOption) => {
    if (!props.values.includes(option.id)) {
      props.onChange([...props.values, option.id]);
    }
    setSearchQuery('');
    setIsAdding(false);
  };

  const handleRemoveValue = (optionId: string) => {
    props.onChange(props.values.filter((id) => id !== optionId));
  };

  // Close when clicking outside
  const handleClickOutside = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Node)) return;

    const isInsideContainer = containerRef?.contains(target);
    const isInsideDropdown = dropdownRef?.contains(target);

    if (!isInsideContainer && !isInsideDropdown) {
      setIsAdding(false);
      setSearchQuery('');
    }
  };

  onMount(() => {
    document.addEventListener('mousedown', handleClickOutside);
    onCleanup(() => {
      document.removeEventListener('mousedown', handleClickOutside);
    });
  });

  return (
    <div class="flex flex-wrap items-center gap-0.5 min-w-0">
      {/* Selected value pills */}
      <For each={props.values}>
        {(optionId) => {
          const option = getOptionById(optionId);
          const displayValue = option
            ? getOptionDisplayValue(option)
            : optionId;
          return (
            <div class="group relative h-6 px-1.5 text-[10px] text-ink border border-edge bg-panel font-mono flex items-center">
              <span class="whitespace-nowrap">{displayValue}</span>
              {/* X shows on hover, overlays the text */}
              <button
                type="button"
                onClick={() => handleRemoveValue(optionId)}
                class="absolute inset-0 flex items-center justify-end pr-1 bg-gradient-to-l from-panel via-panel to-transparent opacity-0 group-hover:opacity-100 hover:text-failure-ink cursor-pointer"
              >
                <XIcon class="size-3" />
              </button>
            </div>
          );
        }}
      </For>

      {/* Add button / input */}
      <div ref={containerRef} class="relative flex items-center">
        <Show
          when={isAdding()}
          fallback={
            <button
              type="button"
              onClick={handleAddClick}
              class="h-6 px-2 text-[10px] text-ink-muted border border-edge hover:bg-hover cursor-pointer font-mono flex items-center"
            >
              {isLoading()
                ? '...'
                : props.values.length === 0
                  ? 'Select...'
                  : '+'}
            </button>
          }
        >
          <input
            ref={inputRef}
            type="text"
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
            placeholder="Search..."
            class="h-6 px-2 min-w-16 w-fit text-[10px] text-ink border border-edge hover:bg-hover focus:ring-1 focus:ring-accent font-mono placeholder:text-ink-muted"
          />
          <div
            ref={dropdownRef}
            class="absolute left-0 top-full mt-1 border border-edge bg-menu shadow-lg font-mono min-w-[160px] max-h-48 overflow-y-auto"
            style={{ 'z-index': zSidePanelSearchAndFilter }}
          >
            <Show
              when={availableOptions().length > 0}
              fallback={
                <div class="px-3 py-2 text-[10px] text-ink-muted text-center">
                  {isLoading()
                    ? 'Loading...'
                    : options().length === 0
                      ? 'No options available'
                      : searchQuery()
                        ? 'No matches'
                        : 'All options selected'}
                </div>
              }
            >
              <For each={availableOptions()}>
                {(option) => (
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleSelectOption(option);
                    }}
                    class="w-full px-2 py-1.5 text-[10px] text-ink hover:bg-hover text-left cursor-pointer"
                  >
                    {getOptionDisplayValue(option)}
                  </button>
                )}
              </For>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
};
