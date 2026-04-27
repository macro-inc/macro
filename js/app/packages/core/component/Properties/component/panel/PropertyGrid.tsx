import { useMaybeBlockAliasedName } from '@core/block';
import { type Component, createMemo, For, Show } from 'solid-js';
import { getBuiltinPropertyIds } from '../../constants';
import { usePropertiesContext } from '../../context/PropertiesContext';
import type { Property } from '../../types';
import { PropertyRow } from './PropertyRow';

interface PropertiesListProps {
  properties: Property[];
  columns?: number;
  withDelete?: boolean;
  withPin?: boolean;
}

export const PropertyGrid: Component<PropertiesListProps> = (props) => {
  const { openPropertyEditor } = usePropertiesContext();

  const blockName = useMaybeBlockAliasedName();
  const builtinPropertyIds = blockName ? getBuiltinPropertyIds(blockName) : [];

  // Single pass through properties array to split into metadata, builtin, and user properties
  const propertyGroups = createMemo(() => {
    const metadata: Property[] = [];
    const builtinProperties: Property[] = [];
    const userProperties: Property[] = [];

    for (const prop of props.properties) {
      if (prop.isMetadata) {
        // Hide "Project" property if value is null
        if (prop.value != null || !['Project'].includes(prop.displayName)) {
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

  const showSeparatorAboveUser = createMemo(
    () =>
      (propertyGroups().metadata.length > 0 ||
        propertyGroups().builtinProperties.length > 0) &&
      propertyGroups().userProperties.length > 0
  );

  const handleValueClick = (property: Property, anchor?: HTMLElement) => {
    if (
      property.valueType === 'DATE' ||
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
      <div
        class="grid gap-x-4 gap-y-2 pt-2 min-w-fit"
        style={{
          'grid-template-columns': `repeat(${props.columns ?? 1}, minmax(4rem, 12rem) minmax(8rem, 1fr))`,
        }}
      >
        {/* Metadata properties */}
        <Show when={propertyGroups().metadata.length > 0}>
          <For each={propertyGroups().metadata}>
            {(property) => (
              <PropertyRow
                property={property}
                onValueClick={handleValueClick}
                withPin
              />
            )}
          </For>
        </Show>

        {/* Builtin properties (block-specific, non-removable) */}
        <Show when={propertyGroups().builtinProperties.length > 0}>
          <For each={propertyGroups().builtinProperties}>
            {(property) => (
              <PropertyRow
                property={property}
                onValueClick={handleValueClick}
                withPin
              />
            )}
          </For>
        </Show>

        {/* User properties */}
        <Show when={propertyGroups().userProperties.length > 0}>
          {/* Separator between above user */}
          <Show when={showSeparatorAboveUser()}>
            <div class="col-span-2 border-t border-edge-muted my-4" />
          </Show>

          <For each={propertyGroups().userProperties}>
            {(property) => (
              <PropertyRow
                property={property}
                onValueClick={handleValueClick}
                withDelete={props.withDelete}
                withPin={props.withPin}
              />
            )}
          </For>
        </Show>
      </div>
    </Show>
  );
};
