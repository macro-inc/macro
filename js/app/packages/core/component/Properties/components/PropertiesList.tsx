import { createMemo, For, Show } from 'solid-js';
import { usePropertiesContext } from '../context/PropertiesContext';
import type { Property } from '../types';
import { PropertyRow } from './PropertyRow';

interface PropertiesListProps {
  properties: Property[];
}

export function PropertiesList(props: PropertiesListProps) {
  const { openModal } = usePropertiesContext();

  const metadataProperties = createMemo(() =>
    props.properties.filter(
      (prop) =>
        prop.isMetadata &&
        // Hide "Project" property if value is null
        !(prop.displayName === 'Project' && prop.value === undefined)
    )
  );

  const editableProperties = createMemo(() =>
    props.properties.filter((prop) => !prop.isMetadata)
  );

  const showSeparator = createMemo(
    () => metadataProperties().length > 0 && editableProperties().length > 0
  );

  const handleValueClick = (property: Property, anchor?: HTMLElement) => {
    if (property.valueType === 'DATE') {
      openModal('date-picker', property, anchor);
    } else {
      openModal('edit-property', property, anchor);
    }
  };

  return (
    <Show
      when={props.properties.length > 0}
      fallback={
        <div class="text-center">
          <div class="text-ink-muted">No properties found</div>
        </div>
      }
    >
      <div class="grid grid-cols-[minmax(auto,50%)_1fr] gap-x-4 gap-y-3 pt-2">
        <Show when={metadataProperties().length > 0}>
          <For each={metadataProperties()}>
            {(property) => (
              <PropertyRow
                property={property}
                onValueClick={handleValueClick}
              />
            )}
          </For>
        </Show>

        <Show when={showSeparator()}>
          <div class="col-span-2 border-t border-edge my-4" />
        </Show>

        <Show when={editableProperties().length > 0}>
          <For each={editableProperties()}>
            {(property) => (
              <PropertyRow
                property={property}
                onValueClick={handleValueClick}
              />
            )}
          </For>
        </Show>
      </div>
    </Show>
  );
}
