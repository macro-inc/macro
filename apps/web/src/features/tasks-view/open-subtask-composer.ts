import { createTaskWithProperties } from '@app/features/block-md/util/taskComposerProperties';
import type { useSplitLayout } from '@components/app/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { fetchEntityProperties } from '@queries/properties/entity';
import { EntityType } from '@service-properties/generated/schemas/entityType';

/** Opens the task composer for a new task under `parentId`. */
export function openSubtaskComposer(
  layout: ReturnType<typeof useSplitLayout>,
  parentId: string
) {
  const create: typeof createTaskWithProperties = async (
    title,
    content,
    values,
    definitions,
    history,
    options
  ) => {
    const created = await createTaskWithProperties(
      title,
      content,
      [
        ...values.filter(([id]) => id !== SYSTEM_PROPERTY_IDS.PARENT_TASK),
        [
          SYSTEM_PROPERTY_IDS.PARENT_TASK,
          {
            valueType: 'ENTITY',
            refs: [{ entity_id: parentId, entity_type: EntityType.TASK }],
          },
        ],
      ],
      definitions,
      history,
      options
    );
    if (created) {
      const properties = await fetchEntityProperties(
        'TASK',
        created.documentId
      ).catch(() => undefined);
      const parent = properties?.find(
        (property) =>
          property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.PARENT_TASK
      );
      if (
        !(
          parent?.valueType === 'ENTITY' &&
          parent.value?.some(
            (ref) =>
              ref.entity_id === parentId && ref.entity_type === EntityType.TASK
          )
        )
      ) {
        toast.failure(
          'Task created, but its parent could not be confirmed. Open the task to set its parent; do not create it again.'
        );
      }
    }
    return created;
  };
  layout.popoverSplit({
    type: 'component',
    id: 'task-compose',
    params: { createTask: create },
  });
}
