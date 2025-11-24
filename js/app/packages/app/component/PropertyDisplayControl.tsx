import { IconButton } from '@core/component/IconButton';
import type { PropertyDefinitionFlat } from '@core/component/Properties/types';
import { PropertyDataTypeIcon } from '@core/component/Properties/utils';
import { ERROR_MESSAGES } from '@core/component/Properties/utils/errorHandling';
import { toast } from '@core/component/Toast/Toast';
import { isErr } from '@core/util/maybeResult';
import DeleteIcon from '@icon/bold/x-bold.svg';
import { propertiesServiceClient } from '@service-properties/client';
import type { Accessor, Component } from 'solid-js';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import type { DisplayOptions } from './ViewConfig';

const MAX_DISPLAY_PROPERTIES = 4;

type PropertyDisplayControlProps = {
  selectedPropertyIds: Accessor<DisplayOptions['displayProperties']>;
  setSelectedPropertyIds: (
    properties: DisplayOptions['displayProperties']
  ) => void;
  suggestedProperties?: PropertyDefinitionFlat[];
};

type PropertyPillProps = {
  property: PropertyDefinitionFlat;
  onRemove: () => void;
};

type SuggestedPillProps = {
  property: PropertyDefinitionFlat;
  onClick: () => void;
};

type PropertyDropdownProps = {
  filteredProperties: Accessor<PropertyDefinitionFlat[]>;
  onSelectProperty: (property: PropertyDefinitionFlat) => void;
  dropdownRef: (el: HTMLDivElement) => void;
  isOpen: Accessor<boolean>;
};

const PropertyDropdown: Component<PropertyDropdownProps> = (props) => {
  return (
    <Show when={props.isOpen()}>
      <div
        ref={props.dropdownRef}
        class="absolute left-0 right-0 top-full mt-1 z-[100]
               border border-edge bg-menu shadow-lg
               max-h-48 overflow-y-auto
               font-mono"
      >
        <Show
          when={props.filteredProperties().length > 0}
          fallback={
            <div class="px-3 py-2 text-xs text-ink-muted text-center">
              No properties found
            </div>
          }
        >
          <For each={props.filteredProperties()}>
            {(property) => (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault(); // Prevent input blur
                  e.stopPropagation(); // Prevent click outside handler
                  props.onSelectProperty(property);
                }}
                class="w-full px-2 py-1.5
                       text-xs text-ink
                       hover:bg-hover
                       flex items-center gap-2
                       text-left"
              >
                <PropertyDataTypeIcon property={property} />
                <span class="truncate flex-1">{property.display_name}</span>
              </button>
            )}
          </For>
        </Show>
      </div>
    </Show>
  );
};

const SuggestedPill: Component<SuggestedPillProps> = (props) => {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class="inline-flex max-w-[140px] shrink-0
             w-fit min-h-[24px]
             items-center gap-2
             px-2 py-1
             text-xs text-ink
             bg-transparent hover:bg-hover
             border border-edge
             cursor-pointer
             transition-colors"
    >
      <PropertyDataTypeIcon property={props.property} />
      <span class="truncate flex-1 font-mono">
        {props.property.display_name}
      </span>
    </button>
  );
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
               inline-flex items-center gap-2
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
  const [isDropdownOpen, setIsDropdownOpen] = createSignal(false);

  let searchInputRef!: HTMLInputElement;
  let dropdownRef!: HTMLDivElement;
  let containerRef!: HTMLDivElement;

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

  const suggestedProperties = createMemo(() => {
    const allSuggested = props.suggestedProperties ?? [];
    const selectedIds = new Set(props.selectedPropertyIds());
    return allSuggested.filter((property) => !selectedIds.has(property.id));
  });

  const handleSuggestedSelect = (property: PropertyDefinitionFlat) => {
    const currentIds = props.selectedPropertyIds();
    if (!currentIds.includes(property.id)) {
      const currentIds = props.selectedPropertyIds();
      // Enforce max 6 properties
      if (currentIds.length >= MAX_DISPLAY_PROPERTIES) {
        toast.failure('You can only select up to 6 properties to display.');
        return;
      }

      props.setSelectedPropertyIds([...currentIds, property.id]);
    }
  };

  const handleRemoveProperty = (propertyId: string) => {
    const currentIds = props.selectedPropertyIds();
    props.setSelectedPropertyIds(currentIds.filter((id) => id !== propertyId));
  };

  const handleSelectProperty = (property: PropertyDefinitionFlat) => {
    const currentIds = props.selectedPropertyIds();
    // Enforce max 6 properties
    if (currentIds.length >= 6) {
      toast.failure('You can only select up to 6 properties to display.');
      return;
    }

    if (!currentIds.includes(property.id)) {
      props.setSelectedPropertyIds([...currentIds, property.id]);
      setSearchQuery('');
      searchInputRef?.focus();
    }
  };

  const filteredProperties = createMemo(() => {
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

  // Close dropdown when clicking or focusing outside the container
  createEffect(() => {
    if (!isDropdownOpen()) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;

      const path = event.composedPath();

      // Don't close if clicking inside container or dropdown
      // Check both composedPath and contains for reliability
      const isInsideContainer =
        containerRef &&
        (path.includes(containerRef) || containerRef.contains(target));
      const isInsideDropdown =
        dropdownRef &&
        (path.includes(dropdownRef) || dropdownRef.contains(target));

      if (isInsideContainer || isInsideDropdown) {
        return;
      }

      setIsDropdownOpen(false);
    };

    const handleFocusOutside = () => {
      const activeElement = document.activeElement;
      if (
        activeElement &&
        containerRef &&
        !containerRef.contains(activeElement) &&
        dropdownRef &&
        !dropdownRef.contains(activeElement)
      ) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('focusin', handleFocusOutside);

    onCleanup(() => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('focusin', handleFocusOutside);
    });
  });

  return (
    <>
      <div class="font-medium text-xs mb-2">Display Properties</div>

      <Show when={suggestedProperties().length > 0}>
        <div class="mb-2 px-2">
          <div class="text-xs text-ink-muted mb-1">Suggested Properties</div>
          <div
            class="w-full h-fit
                   flex flex-wrap items-start justify-start
                   gap-1"
          >
            <For each={suggestedProperties()}>
              {(property) => (
                <SuggestedPill
                  property={property}
                  onClick={() => handleSuggestedSelect(property)}
                />
              )}
            </For>
          </div>
        </div>
      </Show>

      <div
        ref={containerRef}
        class="flex flex-col
                border border-edge
                w-full max-w-full
                focus-within:ring-2 focus-within:ring-accent/50 focus-within:border-accent"
      >
        <Show when={selectedProperties().length > 0}>
          <div
            class="w-full h-fit
                   flex flex-wrap items-start justify-start
                   gap-1
                   px-1.5 pt-1.5 pb-0.5"
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

        <div class="px-1 py-0.5 relative">
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
            class="w-full
                   px-2 py-1
                   font-mono text-xs
                   text-ink placeholder-ink-muted
                   bg-transparent"
          />

          <PropertyDropdown
            filteredProperties={filteredProperties}
            onSelectProperty={handleSelectProperty}
            dropdownRef={(el) => {
              dropdownRef = el;
            }}
            isOpen={isDropdownOpen}
          />
        </div>
      </div>
    </>
  );
};
