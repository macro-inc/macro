import { useSidePanel } from '@app/component/side-panel';
import { useBlockAliasedName, useBlockId } from '@core/block';
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
import { createMemo, For, Show, Suspense } from 'solid-js';
import { InlinePropertyValue } from './InlinePropertyValue';

/**
 * Inline task properties shown below the title when the side panel is closed.
 * Displays status, priority, and assignees in a single row, editable like in list view.
 */
export function InlineTaskProperties() {
  const blockId = useBlockId();
  const blockName = useBlockAliasedName();
  const sidePanel = useSidePanel();
  const canEdit = useCanEdit();
  const documentName = useBlockDocumentName();

  const isTask = () => blockName === 'task';

  // Only show when side panel is closed or doesn't exist
  const shouldShow = () => {
    if (!isTask()) return false;
    // If no side panel context, show properties inline
    if (!sidePanel) return true;
    // In narrow mode, always show (side panel is an overlay)
    if (sidePanel.isNarrow()) return true;
    // In wide mode, show when panel is closed
    return !sidePanel.isOpen();
  };

  const { properties, refetch } = useEntityProperties(blockId, 'TASK', false);

  // Get the three main properties we want to display
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
      properties: [
        { entityId: blockId, entityType: 'TASK', property, apiValues },
      ],
    });

  const saveHandler: PropertySaveHandler = {
    saveProperty: (property, value) => saveOne(property, value),
    saveDate: (property, date) =>
      saveOne(property, { valueType: 'DATE', value: date }),
  };

  return (
    <Show when={shouldShow()}>
      <Suspense>
        <Show when={inlineProperties().length > 0}>
          <PropertiesProvider
            entityType="TASK"
            canEdit={canEdit()}
            documentName={documentName()}
            properties={inlineProperties}
            onRefresh={refetch}
            onPropertyAdded={refetch}
            onPropertyDeleted={refetch}
            saveHandler={saveHandler}
          >
            <div class="flex flex-row flex-wrap items-center gap-1 text-base mb-6">
              <For each={inlineProperties()}>
                {(property) => <InlinePropertyValue property={property} />}
              </For>
            </div>
            <Modals />
          </PropertiesProvider>
        </Show>
      </Suspense>
    </Show>
  );
}
