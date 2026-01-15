import type { PropertyDefinitionDomain } from '@core/component/Properties/types';
import {
  isPropertyDefinition,
  PropertyDataTypeIcon,
  toPropertyDefinitionDomain,
} from '@core/component/Properties/utils';
import MagnifyingGlassIcon from '@phosphor-icons/core/assets/regular/magnifying-glass.svg';
import { useListPropertiesQuery } from '@queries/properties/definitions';
import type { Component } from 'solid-js';
import {
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { isFilterableDataType } from '../PropertyFilterTypes';

export type FilterPropertySelectProps = {
  onSelectProperty: (property: PropertyDefinitionDomain) => void;
  onCancel?: () => void;
};

export const FilterPropertySelect: Component<FilterPropertySelectProps> = (
  props
) => {
  const [searchQuery, setSearchQuery] = createSignal('');
  const [isDropdownOpen, setIsDropdownOpen] = createSignal(false);

  let searchInputRef!: HTMLInputElement;
  let dropdownRef!: HTMLDivElement;
  let containerRef!: HTMLDivElement;

  const propertiesQuery = useListPropertiesQuery(() => ({
    scope: 'all',
    includeOptions: false,
  }));

  const availableProperties = createMemo((): PropertyDefinitionDomain[] => {
    const data = propertiesQuery.data;
    if (!data) return [];
    return (Array.isArray(data) ? data : [])
      .filter(isPropertyDefinition)
      .map((def) => toPropertyDefinitionDomain(def));
  });

  // Filter to only filterable properties (exclude COMPANY entity type)
  const filterableProperties = createMemo(() => {
    return availableProperties().filter(
      (property) =>
        isFilterableDataType(property.valueType) &&
        property.specificEntityType !== 'COMPANY'
    );
  });

  const filteredProperties = createMemo(() => {
    const query = searchQuery().toLowerCase().trim();
    const properties = filterableProperties();

    if (!query) return properties;

    return properties.filter((property) => {
      const name = property.displayName.toLowerCase();
      return name.includes(query);
    });
  });

  const handleSelectProperty = (property: PropertyDefinitionDomain) => {
    props.onSelectProperty(property);
    setSearchQuery('');
    setIsDropdownOpen(false);
  };

  // Close dropdown and cancel when clicking outside
  const handleClickOutside = (event: MouseEvent) => {
    if (!isDropdownOpen()) return;
    const target = event.target;
    if (!(target instanceof Node)) return;

    const isInsideContainer = containerRef?.contains(target);
    const isInsideDropdown = dropdownRef?.contains(target);

    if (!isInsideContainer && !isInsideDropdown) {
      setIsDropdownOpen(false);
      props.onCancel?.();
    }
  };

  onMount(() => {
    // Autofocus the search input
    searchInputRef?.focus();
    document.addEventListener('mousedown', handleClickOutside);
    onCleanup(() =>
      document.removeEventListener('mousedown', handleClickOutside)
    );
  });

  return (
    <div ref={containerRef} class="flex relative w-full h-6">
      <MagnifyingGlassIcon class="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-ink-muted pointer-events-none" />
      <input
        ref={searchInputRef}
        type="text"
        value={searchQuery()}
        onInput={(e) => {
          setSearchQuery(e.currentTarget.value);
          setIsDropdownOpen(true);
        }}
        onFocus={() => setIsDropdownOpen(true)}
        placeholder="Search Properties..."
        class="w-full h-full pl-6 pr-2 font-mono text-xxs text-ink placeholder-ink-muted bg-transparent border border-edge focus:ring-2 focus:ring-accent/50 focus:border-accent"
      />
      <Show when={isDropdownOpen()}>
        <div
          ref={dropdownRef}
          class="absolute left-0 right-0 top-full mt-1 border border-edge bg-menu shadow-lg max-h-48 overflow-y-auto font-mono z-1"
        >
          <Show
            when={filteredProperties().length > 0}
            fallback={
              <div class="px-3 py-2 text-xxs text-ink-muted text-center">
                No filterable properties found
              </div>
            }
          >
            <For each={filteredProperties()}>
              {(property) => (
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleSelectProperty(property);
                  }}
                  class="w-full px-2 py-1.5 text-xxs text-ink hover:bg-hover flex items-center gap-2 text-left"
                >
                  <PropertyDataTypeIcon property={property} />
                  <span class="truncate flex-1">{property.displayName}</span>
                </button>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  );
};
