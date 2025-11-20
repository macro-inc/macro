import { type Component, createMemo, For, Show } from 'solid-js';
import { usePropertiesContext } from '../../context/PropertiesContext';
import type { Property } from '../../types';
import { PropertyRow } from './PropertyRow';

interface PropertiesListProps {
  properties: Property[];
}

export const PropertyGrid: Component<PropertiesListProps> = (props) => {
  const { openPropertyEditor, openDatePicker } = usePropertiesContext();

  // Single pass through properties array to split into metadata and editable
  // More efficient than two separate filter operations
  const propertyGroups = createMemo(() => {
    const metadata: Property[] = [];
    const editable: Property[] = [];

    for (const prop of props.properties) {
      if (prop.isMetadata) {
        // Hide "Project" property if value is null
        if (!(prop.displayName === 'Project' && prop.value == null)) {
          metadata.push(prop);
        }
      } else {
        editable.push(prop);
      }
    }

    return { metadata, editable };
  });

  const showSeparator = createMemo(
    () =>
      propertyGroups().metadata.length > 0 &&
      propertyGroups().editable.length > 0
  );

  const handleValueClick = (property: Property, anchor?: HTMLElement) => {
    if (property.valueType === 'DATE') {
      openDatePicker(property, anchor);
    } else if (
      property.valueType === 'SELECT_STRING' ||
      property.valueType === 'SELECT_NUMBER' ||
      property.valueType === 'ENTITY'
    ) {
      openPropertyEditor(property, anchor);
    }
    // LINK, STRING, NUMBER, BOOLEAN handle their own inline editing
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
      <div class="grid grid-cols-[minmax(120px,50%)_minmax(150px,1fr)] gap-x-4 gap-y-3 pt-2 min-w-fit">
        <Show when={propertyGroups().metadata.length > 0}>
          <For each={propertyGroups().metadata}>
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

        <Show when={propertyGroups().editable.length > 0}>
          <For each={propertyGroups().editable}>
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
};
