import { InlinePropertyValue } from '@block-md/component/InlinePropertyValue';
import {
  getPermissions,
  hasPermissions,
  Permissions,
} from '@core/component/SharePermissions';
import CircleIcon from '@phosphor/circle.svg';
import { Property as PropertyUI } from '@property';
import { Modals } from '@property/component/modal';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import {
  PropertiesProvider,
  type PropertySaveHandler,
} from '@property/context/PropertiesContext';
import { useEntityProperties } from '@property/hooks';
import type { Property, PropertyApiValues } from '@property/types';
import { hasValue } from '@property/utils/typeGuards';
import type { PreviewDocumentProperties } from '@queries/preview/types';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import { useDocumentAccessLevelQuery } from '@queries/storage/document-metadata';
import {
  type Accessor,
  createContext,
  createMemo,
  For,
  type JSX,
  Show,
  useContext,
} from 'solid-js';

const TASK_PREVIEW_PROPERTIES = [
  SYSTEM_PROPERTY_IDS.STATUS,
  SYSTEM_PROPERTY_IDS.PRIORITY,
  SYSTEM_PROPERTY_IDS.ASSIGNEES,
];

type TaskPreviewProps = {
  taskId: string;
  taskName?: string;
  mode?: 'all' | 'status' | 'details';
};

type TaskPreviewData = {
  taskId: Accessor<string>;
  properties: Accessor<Property[]>;
  isLoading: Accessor<boolean>;
  canEdit: Accessor<boolean>;
  refetch: () => void;
};

const TaskPreviewDataContext = createContext<TaskPreviewData>();

/** One data owner for status and details; non-task cards are a passthrough. */
export function TaskPropertiesPreviewProvider(props: {
  taskId?: string;
  previewProperties?: PreviewDocumentProperties;
  children: JSX.Element;
}) {
  return (
    <Show when={props.taskId} keyed fallback={props.children}>
      {(taskId) => (
        <Show
          when={props.previewProperties}
          fallback={
            <RestTaskPreviewProvider taskId={taskId}>
              {props.children}
            </RestTaskPreviewProvider>
          }
        >
          {(metadata) => (
            <TaskPreviewDataContext.Provider
              value={{
                taskId: () => taskId,
                properties: () => metadata().properties ?? [],
                isLoading: () => metadata().properties === undefined,
                canEdit: () => metadata().canEdit,
                refetch: () => void metadata().refetch(),
              }}
            >
              {props.children}
            </TaskPreviewDataContext.Provider>
          )}
        </Show>
      )}
    </Show>
  );
}

function RestTaskPreviewProvider(props: {
  taskId: string;
  children: JSX.Element;
}) {
  const { properties, isLoading, refetch } = useEntityProperties(
    props.taskId,
    'TASK',
    false
  );
  const accessQuery = useDocumentAccessLevelQuery(() => props.taskId);
  return (
    <TaskPreviewDataContext.Provider
      value={{
        taskId: () => props.taskId,
        properties: () => (isLoading() ? [] : properties()),
        isLoading,
        canEdit: () =>
          accessQuery.isSuccess &&
          hasPermissions(
            getPermissions(accessQuery.data),
            Permissions.CAN_EDIT
          ),
        refetch,
      }}
    >
      {props.children}
    </TaskPreviewDataContext.Provider>
  );
}

/** Standalone use gets its own owner; sibling slots reuse the surrounding owner. */
export function TaskPropertiesPreview(
  props: TaskPreviewProps & {
    previewProperties?: PreviewDocumentProperties;
  }
) {
  const shared = useContext(TaskPreviewDataContext);
  return (
    <Show
      when={shared?.taskId() === props.taskId ? shared : undefined}
      fallback={
        <TaskPropertiesPreviewProvider
          taskId={props.taskId}
          previewProperties={props.previewProperties}
        >
          <TaskPropertiesPreview {...props} />
        </TaskPropertiesPreviewProvider>
      }
    >
      {(data) => (
        <TaskPropertiesPreviewContent
          {...props}
          properties={() => data().properties()}
          isLoading={data().isLoading()}
          canEdit={data().canEdit()}
          refetch={() => data().refetch()}
        />
      )}
    </Show>
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
      if (props.mode === 'status' && id !== SYSTEM_PROPERTY_IDS.STATUS)
        return [];
      if (props.mode === 'details' && id === SYSTEM_PROPERTY_IDS.STATUS)
        return [];
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
    <Show
      when={!props.isLoading && previewProperties().length > 0}
      fallback={
        <Show when={props.mode === 'status'}>
          <CircleIcon
            class="size-4 text-ink-muted"
            role="img"
            aria-label={
              props.isLoading
                ? 'Loading task status'
                : 'Task status unavailable'
            }
          />
        </Show>
      }
    >
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
        <Show
          when={props.mode === 'status'}
          fallback={
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
          }
        >
          <For each={previewProperties()}>
            {(property) => (
              <PropertyUI.Root
                property={property}
                canEdit={props.canEdit}
                onSave={saveHandler.saveProperty}
                onRefresh={props.refetch}
              >
                <PropertyUI.Tooltip property={property}>
                  <PropertyUI.EditTrigger
                    class="inline-flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent"
                    aria-disabled={!props.canEdit || !!property.isMetadata}
                  >
                    <Show
                      when={hasValue(property)}
                      fallback={<CircleIcon class="size-4 text-ink-muted" />}
                    >
                      <PropertyUI.Icon property={property} class="size-4" />
                    </Show>
                    <span class="sr-only">
                      Task status:{' '}
                      <PropertyUI.Text
                        property={property}
                        fallback="Not started"
                      />
                    </span>
                  </PropertyUI.EditTrigger>
                </PropertyUI.Tooltip>
                <PropertyUI.PopoverEditor
                  entitySelfFilter={{
                    entityType: 'TASK',
                    blockId: props.taskId,
                  }}
                />
              </PropertyUI.Root>
            )}
          </For>
        </Show>
        <Modals />
      </PropertiesProvider>
    </Show>
  );
}
