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
import type { PreviewDocumentProperties } from '@queries/preview/types';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import { useDocumentAccessLevelQuery } from '@queries/storage/document-metadata';
import { type Accessor, createMemo, For, Show } from 'solid-js';

const TASK_PREVIEW_PROPERTIES = [
  SYSTEM_PROPERTY_IDS.STATUS,
  SYSTEM_PROPERTY_IDS.PRIORITY,
  SYSTEM_PROPERTY_IDS.ASSIGNEES,
];

type TaskPreviewProps = { taskId: string; taskName?: string };

/** Status, priority, and assignee editors; GraphQL previews own their data. */
export function TaskPropertiesPreview(
  props: TaskPreviewProps & {
    previewProperties?: PreviewDocumentProperties;
  }
) {
  return (
    <Show
      when={props.previewProperties}
      fallback={<RestTaskPropertiesPreview {...props} />}
    >
      {(metadata) => (
        <TaskPropertiesPreviewContent
          taskId={props.taskId}
          taskName={props.taskName}
          properties={() => metadata().properties ?? []}
          isLoading={metadata().properties === undefined}
          canEdit={metadata().canEdit}
          refetch={() => void metadata().refetch()}
        />
      )}
    </Show>
  );
}

function RestTaskPropertiesPreview(props: TaskPreviewProps) {
  const { properties, isLoading, refetch } = useEntityProperties(
    props.taskId,
    'TASK',
    false
  );
  const accessQuery = useDocumentAccessLevelQuery(() => props.taskId);
  return (
    <TaskPropertiesPreviewContent
      {...props}
      properties={() => (isLoading() ? [] : properties())}
      isLoading={isLoading()}
      canEdit={
        accessQuery.isSuccess &&
        hasPermissions(getPermissions(accessQuery.data), Permissions.CAN_EDIT)
      }
      refetch={refetch}
    />
  );
}

function TaskPropertiesPreviewContent(
  props: TaskPreviewProps & {
    properties: Accessor<Property[]>;
    isLoading: boolean;
    canEdit: boolean;
    refetch: () => void;
  }
) {
  const saveMutation = useBulkSaveEntityPropertiesMutation();

  const previewProperties = createMemo(() =>
    TASK_PREVIEW_PROPERTIES.flatMap((id) => {
      const property = props
        .properties()
        .find((candidate) => candidate.propertyDefinitionId === id);
      return property ? [property] : [];
    })
  );

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
    <Show when={!props.isLoading && previewProperties().length > 0}>
      <PropertiesProvider
        entityId={props.taskId}
        entityType="TASK"
        canEdit={props.canEdit}
        documentName={props.taskName}
        properties={previewProperties}
        onRefresh={props.refetch}
        onPropertyAdded={props.refetch}
        onPropertyDeleted={props.refetch}
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
