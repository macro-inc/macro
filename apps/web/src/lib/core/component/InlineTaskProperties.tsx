import { UserIcon } from '@core/component/UserIcon';
import { PropertyValueIcon } from '@property/component/propertyValue/PropertyValueIcon';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { useEntityProperties } from '@property/hooks';
import type { Property } from '@property/types';
import type { PreviewDocumentProperties } from '@queries/preview/types';
import { type Accessor, createMemo, Show } from 'solid-js';

/** Inline task badges use their preview's edges; only REST previews fetch separately. */
export function InlineTaskProperties(props: {
  taskId: string;
  previewProperties?: PreviewDocumentProperties;
}) {
  return (
    <Show
      when={props.previewProperties}
      fallback={<RestInlineTaskProperties taskId={props.taskId} />}
    >
      {(metadata) => (
        <InlineTaskPropertyValues
          properties={() => metadata().properties ?? []}
        />
      )}
    </Show>
  );
}

function RestInlineTaskProperties(props: { taskId: string }) {
  const { properties, isLoading } = useEntityProperties(
    props.taskId,
    'TASK',
    false
  );
  return (
    <InlineTaskPropertyValues
      properties={() => (isLoading() ? [] : properties())}
    />
  );
}

function InlineTaskPropertyValues(props: { properties: Accessor<Property[]> }) {
  const statusOptionId = createMemo(() => {
    const p = props
      .properties()
      .find((p) => p.propertyDefinitionId === SYSTEM_PROPERTY_IDS.STATUS);
    return p?.valueType === 'SELECT_STRING' ? p.value?.[0] : undefined;
  });
  const priorityOptionId = createMemo(() => {
    const p = props
      .properties()
      .find((p) => p.propertyDefinitionId === SYSTEM_PROPERTY_IDS.PRIORITY);
    return p?.valueType === 'SELECT_STRING' ? p.value?.[0] : undefined;
  });
  const firstAssigneeId = createMemo(() => {
    const p = props
      .properties()
      .find((p) => p.propertyDefinitionId === SYSTEM_PROPERTY_IDS.ASSIGNEES);
    return p?.valueType === 'ENTITY' ? p.value?.[0]?.entity_id : undefined;
  });
  return (
    <Show when={statusOptionId() || priorityOptionId() || firstAssigneeId()}>
      <span class="inline-flex items-center gap-1 mx-1 align-middle relative top-[-0.05em]">
        <Show when={statusOptionId()}>
          {(id) => <PropertyValueIcon optionId={id()} class="size-3" />}
        </Show>
        <Show when={priorityOptionId()}>
          {(id) => <PropertyValueIcon optionId={id()} class="size-3" />}
        </Show>
        <Show when={firstAssigneeId()}>
          {(id) => (
            <span class="inline-flex ml-0.5 size-3.25">
              <UserIcon
                id={id()}
                isDeleted={false}
                size="fill"
                suppressClick
                showTooltip={false}
              />
            </span>
          )}
        </Show>
      </span>
    </Show>
  );
}
