import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@app/component/split-layout/components/SplitLabel';
import { filterMap } from '@core/util/list';
import { isErr } from '@core/util/maybeResult';
import { propertiesServiceClient } from '@service-properties/client';
import type { PropertyDefinition } from '@service-properties/generated/schemas/propertyDefinition';
import { useQuery } from '@tanstack/solid-query';
import { type Component, createSignal, Show, Suspense } from 'solid-js';
import { createStore, type Store } from 'solid-js/store';
import { propertyApiValuesToNormalized } from '../api/converters';
import { Modals } from '../component/modal';
import { PropertyGrid } from '../component/panel/PropertyGrid';
import { SYSTEM_PROPERTY_IDS } from '../constants';
import {
  PropertiesProvider,
  type PropertySaveHandler,
} from '../context/PropertiesContext';
import type { Property, PropertyApiValues, PropertyOption } from '../types';

const DEBUG_SYSTEM_PROPERTIES = Object.values(SYSTEM_PROPERTY_IDS);

/**
 * Helper to get display value of local property (copied from ComposeTask)
 */
function extractPropertyValue(
  definition: PropertyDefinition,
  savedValues: Store<Record<string, PropertyApiValues>>,
  options: Map<string, PropertyOption[]>
) {
  const { type, value } = propertyApiValuesToNormalized(
    savedValues[definition.id]
  );
  if (type === 'EMPTY') return null;
  if (
    definition.data_type === 'SELECT_NUMBER' ||
    definition.data_type === 'SELECT_STRING'
  ) {
    const opts = options.get(definition.id);
    if (!opts) return null;
    if (Array.isArray(value)) {
      return filterMap(value as string[], (id) => {
        const opt = opts.find((opt) => opt.id === id);
        return opt ? opt.value.value : undefined;
      });
    }
  } else {
    return value;
  }
}

const PropertiesDebug: Component = () => {
  const [refreshKey, setRefreshKey] = createSignal(0);

  // Local property state (like ComposeTask)
  const [propertyValues, setPropertyValues] = createStore<
    Record<string, PropertyApiValues>
  >({});

  // Fetch system properties (copied from ComposeTask)
  const systemPropertiesQuery = useQuery(() => ({
    queryKey: ['properties-debug', 'system-properties', refreshKey()],
    queryFn: async () => {
      const result = await propertiesServiceClient.listProperties({
        scope: 'system',
        include_options: true,
      });
      if (isErr(result)) {
        throw new Error('Failed to fetch system properties');
      }
      const [, data] = result;
      console.log('QUERY DATA', data);
      return data;
    },
    staleTime: 1000 * 60 * 10,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    placeholderData: (prev) => prev,
  }));

  // Build property definitions map (copied from ComposeTask)
  const definitions = () => {
    if (!systemPropertiesQuery.isSuccess) return new Map();
    const data = systemPropertiesQuery.data;
    return new Map(
      data.map((p) => {
        const definition = 'definition' in p ? p.definition : p;
        return [definition.id, definition];
      })
    );
  };

  // Build options map (copied from ComposeTask)
  const options = () => {
    if (!systemPropertiesQuery.isSuccess) return new Map();
    const data = systemPropertiesQuery.data;
    return new Map(
      data.map((p) => {
        const definition = 'definition' in p ? p.definition : p;
        const options = 'property_options' in p ? p.property_options : [];
        return [definition.id, options];
      })
    );
  };

  // Build properties list (copied from ComposeTask)
  const properties = () => {
    return filterMap(DEBUG_SYSTEM_PROPERTIES, (id) => {
      const definition = definitions().get(id);
      if (!definition) return;
      return {
        propertyId: `debug-${definition.display_name}`,
        propertyDefinitionId: definition.id,
        displayName: definition.display_name,
        isMultiSelect: definition.is_multi_select,
        owner: definition.owner,
        specificEntityType: definition.specific_entity_type ?? null,
        updatedAt: '',
        createdAt: '',
        valueType: definition.data_type,
        value: extractPropertyValue(definition, propertyValues, options()),
        options: options().get(definition.id),
      } as Property;
    });
  };

  const saveHandler: PropertySaveHandler = {
    saveProperty: async (property: Property, value: PropertyApiValues) => {
      console.log('Properties Debug - Saving property:', {
        propertyName: property.displayName,
        propertyId: property.propertyDefinitionId,
        valueType: value.valueType,
        value: value,
      });

      setPropertyValues(property.propertyDefinitionId, value);
      return { ok: true, value: undefined };
    },
    saveDate: async (property: Property, date: Date) => {
      console.log('Properties Debug - Saving date:', {
        propertyName: property.displayName,
        propertyId: property.propertyDefinitionId,
        date: date.toISOString(),
      });

      setPropertyValues(property.propertyDefinitionId, {
        valueType: 'DATE',
        value: date.toISOString(),
      });
      return { ok: true, value: undefined };
    },
  };

  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel label="Properties Playground" />
      </SplitHeaderLeft>
      <div class="flex flex-col h-full w-full">
        <div class="flex flex-col gap-4 p-4">
          <Suspense
            fallback={<div class="text-center py-4">Loading Properties...</div>}
          >
            <Show
              when={systemPropertiesQuery.isSuccess && properties().length > 0}
            >
              <div class="border border-edge-muted p-2">
                <div class="bg-surface-secondary rounded-lg">
                  <PropertiesProvider
                    entityType="DOCUMENT"
                    canEdit={true}
                    documentName="Playground"
                    properties={() => properties()}
                    onRefresh={() => console.log('On refresh callback')}
                    onPropertyAdded={() =>
                      console.log('Property added callback')
                    }
                    onPropertyDeleted={() =>
                      console.log('Property deleted callback')
                    }
                    saveHandler={saveHandler}
                  >
                    <PropertyGrid properties={properties()} />
                    <Modals />
                  </PropertiesProvider>
                </div>
              </div>

              <div class="border border-edge-muted p-2">
                <div class="bg-surface-secondary rounded-lg">
                  <PropertiesProvider
                    entityType="DOCUMENT"
                    canEdit={true}
                    documentName="Playground"
                    properties={() => properties()}
                    onRefresh={() => console.log('On refresh callback')}
                    onPropertyAdded={() =>
                      console.log('Property added callback')
                    }
                    onPropertyDeleted={() =>
                      console.log('Property deleted callback')
                    }
                    saveHandler={saveHandler}
                  >
                    <PropertyGrid properties={properties()} columns={2} />
                    <Modals />
                  </PropertiesProvider>
                </div>
              </div>
            </Show>

            <Show
              when={
                systemPropertiesQuery.isSuccess && properties().length === 0
              }
            >
              <div class="border border-edge rounded-lg p-2 text-center">
                <div class="text-text-secondary">
                  No system properties found for the debug property IDs.
                  <br />
                  Available property definitions: {definitions().size}
                </div>
              </div>
            </Show>
          </Suspense>
        </div>
      </div>
    </>
  );
};

export default PropertiesDebug;
