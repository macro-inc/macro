import {
  getPermissions,
  hasPermissions,
  Permissions,
} from '@core/component/SharePermissions';
import { soupPropertyToProperty } from '@entity/extractors-property';
import CircleDashed from '@phosphor/circle-dashed.svg';
import CircleIcon from '@phosphor/circle.svg';
import { Property as PropertyUI } from '@property';
import { PropertyValueIcon } from '@property/component/propertyValue/PropertyValueIcon';
import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';
import { useProperty } from '@property/core/context';
import { useEntityProperties } from '@property/hooks';
import type { Property, PropertyApiValues } from '@property/types';
import type { PreviewDocumentProperties } from '@queries/preview/types';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import { useListPropertiesQuery } from '@queries/properties/definitions';
import { useDocumentAccessLevelQuery } from '@queries/storage/document-metadata';
import { type Accessor, Show, Suspense } from 'solid-js';

/** An inert status for pending or unavailable task previews. */
export function InlineTaskStatusFallback() {
  return (
    <span
      class="inline-flex size-full items-center justify-center"
      aria-label="Task status unavailable"
      on:pointerdown={(event) => event.stopPropagation()}
      on:mousedown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      on:click={(event) => event.stopPropagation()}
    >
      <CircleIcon class="size-full text-ink-muted" />
    </span>
  );
}

export function InlineTaskStatus(props: {
  taskId: string;
  previewProperties?: PreviewDocumentProperties;
}) {
  return (
    <Suspense fallback={<InlineTaskStatusFallback />}>
      <Show
        when={props.previewProperties}
        fallback={<RestInlineTaskStatus taskId={props.taskId} />}
      >
        {(metadata) => (
          <InlineTaskStatusValue
            taskId={props.taskId}
            properties={() => metadata().properties ?? []}
            isLoading={() => metadata().properties === undefined}
            canEdit={() => metadata().canEdit}
            refetch={() => void metadata().refetch()}
          />
        )}
      </Show>
    </Suspense>
  );
}

function RestInlineTaskStatus(props: { taskId: string }) {
  const { properties, isLoading, error, refetch } = useEntityProperties(
    props.taskId,
    'TASK',
    false
  );
  const accessQuery = useDocumentAccessLevelQuery(() => props.taskId);
  return (
    <InlineTaskStatusValue
      taskId={props.taskId}
      properties={() => (isLoading() ? [] : properties())}
      isLoading={isLoading}
      isUnavailable={() => !!error()}
      canEdit={() =>
        accessQuery.isSuccess &&
        hasPermissions(getPermissions(accessQuery.data), Permissions.CAN_EDIT)
      }
      refetch={refetch}
    />
  );
}

function InlineTaskStatusValue(props: {
  taskId: string;
  properties: Accessor<Property[]>;
  isLoading: Accessor<boolean>;
  isUnavailable?: Accessor<boolean>;
  canEdit: Accessor<boolean>;
  refetch: () => void;
}) {
  const saveMutation = useBulkSaveEntityPropertiesMutation();
  const status = () =>
    props
      .properties()
      .find((property) => property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.STATUS);
  const statusDefinitionQuery = useListPropertiesQuery(
    () => ({ scope: 'system', includeOptions: true }),
    () => !props.isLoading() && !props.isUnavailable?.() && !status()
  );
  const displayStatus = () => {
    const assigned = status();
    if (assigned) return assigned;
    const entry = statusDefinitionQuery.data?.find((item) =>
      'definition' in item
        ? item.definition.id === SYSTEM_PROPERTY_IDS.STATUS
        : item.id === SYSTEM_PROPERTY_IDS.STATUS
    );
    if (!entry) return undefined;
    return soupPropertyToProperty({
      id: `pending:${SYSTEM_PROPERTY_IDS.STATUS}`,
      definition: 'definition' in entry ? entry.definition : entry,
    });
  };
  const save = (property: Property, apiValues: PropertyApiValues) =>
    saveMutation.mutateAsync({
      properties: [
        { entityId: props.taskId, entityType: 'TASK', property, apiValues },
      ],
    });

  return (
    <span
      data-inline-task-status
      class="inline-flex size-full items-center justify-center"
      on:pointerdown={(event) => event.stopPropagation()}
      on:mousedown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      on:click={(event) => event.stopPropagation()}
      on:keydown={(event) => event.stopPropagation()}
    >
      <Show
        when={!props.isLoading() && !props.isUnavailable?.()}
        fallback={<InlineTaskStatusFallback />}
      >
        <Show
          when={displayStatus()}
          fallback={
            <span
              aria-label="No status"
              class="inline-flex size-full items-center justify-center"
            >
              <CircleDashed class="size-full text-ink-muted" aria-hidden="true" />
            </span>
          }
        >
          {(property) => (
            <PropertyUI.Root
              class="inline-flex size-full items-center justify-center"
              property={property()}
              canEdit={props.canEdit()}
              onSave={save}
              onRefresh={props.refetch}
            >
              <InlineStatusTrigger property={property()} />
              <PropertyUI.PopoverEditor />
            </PropertyUI.Root>
          )}
        </Show>
      </Show>
    </span>
  );
}

function InlineStatusTrigger(props: { property: Property }) {
  const editor = useProperty();
  const optionId = () =>
    props.property.valueType === 'SELECT_STRING'
      ? props.property.value?.[0]
      : undefined;
  return (
    <button
      type="button"
      class="inline-flex size-full items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-accent"
      aria-disabled={!editor.canEdit() || !!props.property.isMetadata}
      on:click={(event) => {
        event.stopPropagation();
        if (editor.canEdit() && !props.property.isMetadata) {
          editor.openEditor(event.currentTarget);
        }
      }}
    >
      <Show
        when={optionId()}
        fallback={
          <CircleDashed class="size-full text-ink-muted" aria-hidden="true" />
        }
      >
        {(id) => <PropertyValueIcon optionId={id()} class="size-full" />}
      </Show>
      <span class="sr-only">
        Task status:{' '}
        <Show when={optionId()} fallback="No status">
          <PropertyUI.Text property={props.property} fallback="No status" />
        </Show>
      </span>
    </button>
  );
}
