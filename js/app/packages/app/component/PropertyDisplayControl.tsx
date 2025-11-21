import type { PropertyDefinitionFlat } from '@core/component/Properties/types';
import { ERROR_MESSAGES } from '@core/component/Properties/utils/errorHandling';
import { isErr } from '@core/util/maybeResult';
import { propertiesServiceClient } from '@service-properties/client';
import type { Accessor, Component } from 'solid-js';
import { createMemo, createSignal, onMount } from 'solid-js';
import type { DisplayOptions } from './ViewConfig';

type PropertyDisplayControlProps = {
  selectedPropertyIds: Accessor<DisplayOptions['displayProperties']>;
  setSelectedPropertyIds: (
    properties: DisplayOptions['displayProperties']
  ) => void;
};

export const PropertyDisplayControl: Component<PropertyDisplayControlProps> = (
  props
) => {
  const [availableProperties, setAvailableProperties] = createSignal<
    PropertyDefinitionFlat[]
  >([]);
  const [_isLoading, setIsLoading] = createSignal(false);
  const [_error, setError] = createSignal<string | null>(null);
  const [searchQuery, setSearchQuery] = createSignal('');

  let searchInputRef!: HTMLInputElement;

  const fetchAvailableProperties = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await propertiesServiceClient.listProperties({
        scope: 'all',
        include_options: false,
      });

      if (isErr(result)) {
        setError(ERROR_MESSAGES.PROPERTY_FETCH);
        setIsLoading(false);
        return;
      }

      const [, data] = result;
      const properties = Array.isArray(data) ? data : [];

      setAvailableProperties(properties);
      setIsLoading(false);
    } catch (_apiError) {
      setError(ERROR_MESSAGES.PROPERTY_FETCH);
      setIsLoading(false);
    }
  };

  const _filteredProperties = createMemo(() => {
    const query = searchQuery().toLowerCase().trim();
    const allProperties = availableProperties();
    const selectedIds = new Set(props.selectedPropertyIds());

    // Filter out already selected properties
    const available = allProperties.filter(
      (property) => !selectedIds.has(property.id)
    );

    // Apply search filter
    if (!query) return available;

    return available.filter((property) => {
      const name = property.display_name.toLowerCase();
      if (name.includes(query)) return true;

      const dataType = property.data_type;
      let typeDisplay = dataType;

      if (dataType === 'ENTITY' && property.specific_entity_type) {
        typeDisplay += ` ${property.specific_entity_type}`;
      }

      return typeDisplay.toLowerCase().includes(query);
    });
  });

  onMount(() => {
    fetchAvailableProperties();
  });

  return (
    <div>
      <div class="font-medium text-xs mb-2">Properties</div>
      <div class="border border-edge">
        {/* Pills will go here in next chunk */}
        <div class="w-full h-full">
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
            placeholder="Search properties..."
            class="w-full
              px-2 py-1
              font-mono text-xs
              text-ink placeholder-ink-muted
              bg-input
              border focus:border-accent
              focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
        </div>
        {/* Search results dropdown will go here in chunk 7 */}
      </div>
    </div>
  );
};
