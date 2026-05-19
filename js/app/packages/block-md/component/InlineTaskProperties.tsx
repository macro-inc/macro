import {
  type BlockAlias,
  type BlockName,
  useBlockAliasedName,
  useBlockId,
} from '@core/block';
import { Modals } from '@core/component/Properties/component/modal';
import { SYSTEM_PROPERTY_IDS } from '@core/component/Properties/constants';
import {
  PropertiesProvider,
  type PropertySaveHandler,
} from '@core/component/Properties/context/PropertiesContext';
import { useEntityProperties } from '@core/component/Properties/hooks';
import type {
  Property,
  PropertyApiValues,
} from '@core/component/Properties/types';
import { useCanEdit } from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { createMemo, For, Show, Suspense } from 'solid-js';
import { match } from 'ts-pattern';
import { InlinePropertyValue } from './InlinePropertyValue';

/**
 * Inline task properties shown below the title when the side panel is closed.
 * Displays status, priority, and assignees in a single row, editable like in list view.
 */
export function InlineTaskProperties() {
  const blockId = useBlockId();
  const blockName = useBlockAliasedName();
  const canEdit = useCanEdit();
  const documentName = useBlockDocumentName();
  const entityType = match<BlockName | BlockAlias, EntityType>(blockName)
    .with('task', () => 'TASK')
    .otherwise(() => 'DOCUMENT');

  const { properties, refetch } = useEntityProperties(
    blockId,
    entityType,
    false
  );

  const inlineProperties = createMemo(() => {
    const props = properties();
    const ids = [
      SYSTEM_PROPERTY_IDS.STATUS,
      SYSTEM_PROPERTY_IDS.PRIORITY,
      SYSTEM_PROPERTY_IDS.ASSIGNEES,
    ];
    return ids
      .map((id) => props.find((p) => p.propertyDefinitionId === id))
      .filter((p): p is Property => p !== undefined);
  });

  const saveMutation = useBulkSaveEntityPropertiesMutation();

  const saveOne = (property: Property, apiValues: PropertyApiValues) =>
    saveMutation.mutateAsync({
      properties: [{ entityId: blockId, entityType, property, apiValues }],
    });

  const saveHandler: PropertySaveHandler = {
    saveProperty: (property, value) => saveOne(property, value),
    saveDate: (property, date) =>
      saveOne(property, { valueType: 'DATE', value: date }),
  };

  return (
    <Suspense>
      <Show when={inlineProperties().length > 0}>
        <PropertiesProvider
          entityType={entityType}
          canEdit={canEdit()}
          documentName={documentName()}
          properties={inlineProperties}
          onRefresh={refetch}
          onPropertyAdded={refetch}
          onPropertyDeleted={refetch}
          saveHandler={saveHandler}
        >
          <div class="flex flex-row flex-wrap items-center gap-2 text-sm mb-6">
            <For each={inlineProperties()}>
              {(property) => <InlinePropertyValue property={property} />}
            </For>
          </div>
          <Modals />
        </PropertiesProvider>
      </Show>
    </Suspense>
  );
}
