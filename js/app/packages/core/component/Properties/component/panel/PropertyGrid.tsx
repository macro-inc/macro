import { useBlockAliasedName } from '@core/block';
import { type Component, createMemo, For, Show } from 'solid-js';
import { getBuiltinPropertyIds } from '../../constants';
import { usePropertiesContext } from '../../context/PropertiesContext';
import type { Property } from '../../types';
import { PropertyRow } from './PropertyRow';

interface PropertiesListProps {
  properties: Property[];
}

export const PropertyGrid: Component<PropertiesListProps> = (props) => {
  const { openPropertyEditor, openDatePicker } = usePropertiesContext();
  const blockName = useBlockAliasedName();
  const builtinPropertyIds = getBuiltinPropertyIds(blockName);

  // Single pass through properties array to split into metadata, builtin, and user properties
  const propertyGroups = createMemo(() => {
    const metadata: Property[] = [];
    const builtinProperties: Property[] = [];
    const userProperties: Property[] = [];

    for (const prop of props.properties) {
      if (prop.isMetadata) {
        // Hide "Project" property if value is null
        if (prop.value != null) {
          metadata.push(prop);
        }
      } else if (builtinPropertyIds.includes(prop.propertyDefinitionId)) {
        builtinProperties.push(prop);
      } else {
        userProperties.push(prop);
      }
    }

    // Sort builtin properties by the order defined in constants
    builtinProperties.sort((a, b) => {
      const indexA = builtinPropertyIds.indexOf(a.propertyDefinitionId);
      const indexB = builtinPropertyIds.indexOf(b.propertyDefinitionId);
      return indexA - indexB;
    });

    return { metadata, builtinProperties, userProperties };
  });

  const showSeparatorAboveBuiltin = createMemo(
    () =>
      propertyGroups().metadata.length > 0 &&
      propertyGroups().builtinProperties.length > 0
  );

  const showSeparatorAboveUser = createMemo(
    () =>
      (propertyGroups().metadata.length > 0 ||
        propertyGroups().builtinProperties.length > 0) &&
      propertyGroups().userProperties.length > 0
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
        {/* Metadata properties */}
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

        {/* Builtin properties (block-specific, non-removable) */}
        <Show when={propertyGroups().builtinProperties.length > 0}>
          {/* Separator above builtin */}
          <Show when={showSeparatorAboveBuiltin()}>
            <div class="col-span-2 border-t border-edge my-4" />
          </Show>

          <For each={propertyGroups().builtinProperties}>
            {(property) => (
              <PropertyRow
                property={property}
                onValueClick={handleValueClick}
              />
            )}
          </For>
        </Show>

        {/* User properties */}
        <Show when={propertyGroups().userProperties.length > 0}>
          {/* Separator between above user */}
          <Show when={showSeparatorAboveUser()}>
            <div class="col-span-2 border-t border-edge my-4" />
          </Show>

          <For each={propertyGroups().userProperties}>
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
