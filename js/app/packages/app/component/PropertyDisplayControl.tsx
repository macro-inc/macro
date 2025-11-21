import { IconButton } from '@core/component/IconButton';
import type { PropertyDefinitionFlat } from '@core/component/Properties/types';
import { PropertyDataTypeIcon } from '@core/component/Properties/utils';
import { ERROR_MESSAGES } from '@core/component/Properties/utils/errorHandling';
import { isErr } from '@core/util/maybeResult';
import DeleteIcon from '@icon/bold/x-bold.svg';
import { propertiesServiceClient } from '@service-properties/client';
import type { Accessor, Component } from 'solid-js';
import { createMemo, createSignal, For, onMount, Show } from 'solid-js';
import type { DisplayOptions } from './ViewConfig';

type PropertyDisplayControlProps = {
  selectedPropertyIds: Accessor<DisplayOptions['displayProperties']>;
  setSelectedPropertyIds: (
    properties: DisplayOptions['displayProperties']
  ) => void;
};

type PropertyPillProps = {
  property: PropertyDefinitionFlat;
  onRemove: () => void;
};

const PropertyPill: Component<PropertyPillProps> = (props) => {
  const [isHovered, setIsHovered] = createSignal(false);

  return (
    <div
      class="relative inline-flex max-w-[140px] shrink-0"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        class="w-full min-h-[24px]
               inline-flex items-center gap-1
               px-2 py-1
               text-xs text-ink
               bg-transparent hover:bg-hover
               border border-edge
               cursor-pointer"
      >
        <PropertyDataTypeIcon property={props.property} />
        <span class="truncate flex-1 font-mono">
          {props.property.display_name}
        </span>
        <Show when={isHovered()}>
          <div class="absolute right-1 inset-y-0 flex items-center">
            <IconButton
              icon={DeleteIcon}
              theme="clear"
              size="xs"
              class="!text-failure !bg-[#2a2a2a] hover:!bg-[#444444] !cursor-pointer !w-4 !h-4 !min-w-4 !min-h-4"
              onClick={(e) => {
                e.stopPropagation();
                props.onRemove();
              }}
            />
          </div>
        </Show>
      </div>
    </div>
  );
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

  const selectedProperties = createMemo(() => {
    const selectedIds = props.selectedPropertyIds();
    const allProperties = availableProperties();
    return allProperties.filter((property) =>
      selectedIds.includes(property.id)
    );
  });

  const handleRemoveProperty = (propertyId: string) => {
    const currentIds = props.selectedPropertyIds();
    props.setSelectedPropertyIds(currentIds.filter((id) => id !== propertyId));
  };

  const _filteredProperties = createMemo(() => {
    const query = searchQuery().toLowerCase().trim();
    const allProperties = availableProperties();
    const selectedIds = new Set(props.selectedPropertyIds());

    const available = allProperties.filter(
      (property) => !selectedIds.has(property.id)
    );

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
    <>
      <div class="font-medium text-xs mb-2">Properties</div>

      <div
        class="flex flex-col
                border border-edge
                w-full max-w-full overflow-hidden
                focus-within:ring-2 focus-within:ring-accent/50 focus-within:border-accent"
      >
        <Show when={selectedProperties().length > 0}>
          <div
            class="w-full h-fit
                   flex flex-wrap items-start justify-start
                   gap-1
                   p-1.5"
          >
            <For each={selectedProperties()}>
              {(property) => (
                <PropertyPill
                  property={property}
                  onRemove={() => handleRemoveProperty(property.id)}
                />
              )}
            </For>
          </div>
        </Show>

        <div class="px-1 py-0.5">
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
            placeholder="+ Add Property"
            class="w-full
                   px-2 py-1
                   font-mono text-xs
                   text-ink placeholder-ink-muted
                   bg-transparent"
          />
        </div>

        {/* Search results dropdown will go here in chunk 7 */}
      </div>
    </>
  );
};
