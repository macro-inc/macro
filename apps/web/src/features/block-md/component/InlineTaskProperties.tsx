import {
  type BlockAlias,
  type BlockName,
  useBlockAliasedName,
  useBlockId,
} from '@core/block';
import { ProgressChip } from '@core/component/LexicalMarkdown/component/status/Progress';
import { useCanEdit } from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { Modals } from '@property/component/modal';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import {
  PropertiesProvider,
  type PropertySaveHandler,
} from '@property/context/PropertiesContext';
import { useEntityProperties } from '@property/hooks';
import { InlineFetchedEntityTagsPill } from '@property/tags';
import type { Property, PropertyApiValues } from '@property/types';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { createMemo, For, Show, Suspense } from 'solid-js';
import { match } from 'ts-pattern';
import { mdStore } from '../signal/markdownBlockData';
import { InlinePropertyValue } from './InlinePropertyValue';

/**
 * Inline task properties shown below the title when the side panel is closed.
 * Displays status, priority, and assignees in a single row, editable like in list view.
 */
export function InlineTaskProperties() {
  const md = mdStore.get;
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
  const shouldShowRow = createMemo(
    () =>
      blockName === 'task' ||
      blockName === 'md' ||
      inlineProperties().length > 0
  );

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
      <Show when={shouldShowRow()}>
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
          <For each={inlineProperties()}>
            {(property) => (
              <InlinePropertyValue
                property={property}
                class="bg-surface-2 border border-edge"
              />
            )}
          </For>
          <InlineFetchedEntityTagsPill
            entityId={blockId}
            entityType={entityType}
            class="bg-surface-2"
          />
          <Show when={blockName === 'task' && md.progressStats}>
            {(progressStats) => (
              <Show when={progressStats().total > 0}>
                <ProgressChip stats={progressStats()} />
              </Show>
            )}
          </Show>
          <Modals />
        </PropertiesProvider>
      </Show>
    </Suspense>
  );
}
