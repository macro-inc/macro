import { InlinePropertyValue } from '@block-md/component/InlinePropertyValue';
import {
  getPermissions,
  hasPermissions,
  Permissions,
} from '@core/component/SharePermissions';
import { Modals } from '@property/component/modal';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import {
  PropertiesProvider,
  type PropertySaveHandler,
} from '@property/context/PropertiesContext';
import { useEntityProperties } from '@property/hooks';
import type { Property, PropertyApiValues } from '@property/types';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import { useDocumentAccessLevelQuery } from '@queries/storage/document-metadata';
import { createMemo, For, Show } from 'solid-js';

const TASK_PREVIEW_PROPERTIES = [
  SYSTEM_PROPERTY_IDS.STATUS,
  SYSTEM_PROPERTY_IDS.PRIORITY,
  SYSTEM_PROPERTY_IDS.ASSIGNEES,
];

/** Status, priority, and assignee editors for a task preview card. */
export function TaskPropertiesPreview(props: {
  taskId: string;
  taskName?: string;
}) {
  const { properties, isLoading, refetch } = useEntityProperties(
    props.taskId,
    'TASK',
    false
  );
  const accessQuery = useDocumentAccessLevelQuery(() => props.taskId);
  const saveMutation = useBulkSaveEntityPropertiesMutation();

  const previewProperties = createMemo(() =>
    TASK_PREVIEW_PROPERTIES.flatMap((id) => {
      const property = properties().find(
        (candidate) => candidate.propertyDefinitionId === id
      );
      return property ? [property] : [];
    })
  );

  const canEdit = () =>
    accessQuery.isSuccess &&
    hasPermissions(getPermissions(accessQuery.data), Permissions.CAN_EDIT);

  const saveOne = (property: Property, apiValues: PropertyApiValues) =>
    saveMutation.mutateAsync({
      properties: [
        { entityId: props.taskId, entityType: 'TASK', property, apiValues },
      ],
    });

  const saveHandler: PropertySaveHandler = {
    saveProperty: (property, value) => saveOne(property, value),
    saveDate: (property, date) =>
      saveOne(property, { valueType: 'DATE', value: date }),
  };

  return (
    <Show when={!isLoading() && previewProperties().length > 0}>
      <PropertiesProvider
        entityId={props.taskId}
        entityType="TASK"
        canEdit={canEdit()}
        documentName={props.taskName}
        properties={previewProperties}
        onRefresh={refetch}
        onPropertyAdded={refetch}
        onPropertyDeleted={refetch}
        saveHandler={saveHandler}
      >
        <div class="px-2 pb-2 flex flex-row flex-wrap gap-1 text-xs justify-start">
          <For each={previewProperties()}>
            {(property) => (
              <InlinePropertyValue
                property={property}
                entityId={props.taskId}
                class="bg-surface-2 border border-edge"
              />
            )}
          </For>
        </div>
        <Modals />
      </PropertiesProvider>
    </Show>
  );
}
