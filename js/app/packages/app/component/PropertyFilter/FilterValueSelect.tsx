import { isErr } from '@core/util/maybeResult';
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

export type FilterValueSelectProps = {
  propertyId: string;
  dataType: 'SELECT_STRING' | 'SELECT_NUMBER';
  value: string | null; // option ID
  onChange: (optionId: string) => void;
};

export const FilterValueSelect: Component<FilterValueSelectProps> = (props) => {
  const [isEditing, setIsEditing] = createSignal(false);
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

  // Get selected option display
  const selectedDisplay = () => {
    if (isLoading()) return '...';
    if (!props.value) return 'Select...';
    const option = options().find((o) => o.id === props.value);
    if (!option) return 'Select...';
    return getOptionDisplayValue(option);
  };

  // Filter options by search query
  const filteredOptions = createMemo(() => {
    const query = searchQuery().toLowerCase().trim();
    if (!query) return options();
    return options().filter((o) =>
      getOptionDisplayValue(o).toLowerCase().includes(query)
    );
  });

  const handleClick = () => {
    setIsEditing(true);
    setSearchQuery('');
    setTimeout(() => inputRef?.focus(), 0);
  };

  const handleSelectOption = (option: PropertyOption) => {
    props.onChange(option.id);
    setSearchQuery('');
    setIsEditing(false);
  };

  // Close when clicking outside
  const handleClickOutside = (event: MouseEvent) => {
    if (!isEditing()) return;
    const target = event.target;
    if (!(target instanceof Node)) return;

    const isInsideContainer = containerRef?.contains(target);
    const isInsideDropdown = dropdownRef?.contains(target);

    if (!isInsideContainer && !isInsideDropdown) {
      setIsEditing(false);
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
    <div ref={containerRef} class="relative">
      <Show
        when={isEditing()}
        fallback={
          <button
            type="button"
            onClick={handleClick}
            class="h-6 px-2 w-fit text-xxs border border-edge hover:bg-hover text-left font-mono flex items-center"
            classList={{
              'text-ink': props.value !== null,
              'text-ink-muted': props.value === null,
            }}
          >
            {selectedDisplay()}
          </button>
        }
      >
        <input
          ref={inputRef}
          type="text"
          value={searchQuery()}
          onInput={(e) => setSearchQuery(e.currentTarget.value)}
          placeholder="Search..."
          class="h-6 px-2 min-w-16 w-fit text-xxs text-ink border border-edge hover:bg-hover focus:ring-1 focus:ring-accent font-mono placeholder:text-ink-muted"
        />
        <div
          ref={dropdownRef}
          class="absolute left-0 top-full mt-1 border border-edge bg-surface shadow-lg font-mono min-w-40 max-h-48 overflow-y-auto z-user-highlight"
        >
          <Show
            when={filteredOptions().length > 0}
            fallback={
              <div class="px-3 py-2 text-xxs text-ink-muted text-center">
                {isLoading()
                  ? 'Loading...'
                  : options().length === 0
                    ? 'No options available'
                    : 'No matches'}
              </div>
            }
          >
            <For each={filteredOptions()}>
              {(option) => (
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleSelectOption(option);
                  }}
                  class="w-full px-2 py-1.5 text-xxs text-ink hover:bg-hover text-left"
                  classList={{
                    'bg-hover': props.value === option.id,
                  }}
                >
                  {getOptionDisplayValue(option)}
                </button>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  );
};
