import { toast } from '@core/component/Toast/Toast';
import type { TaskEntityWithProperties } from '@entity';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { toPropertyDefinitionDomain } from '@property/utils/transforms';
import { useListPropertiesQuery } from '@queries/properties/definitions';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import { useDocumentAccessLevelsQuery } from '@queries/storage/document-metadata';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import type { TasksDataSourceItem } from './use-tasks-query';

/** Restricts timeline edits to loaded tasks with document access and a system due date. */
export function createTaskGanttQueries(
  rows: Accessor<readonly TasksDataSourceItem[]>
) {
  const tasks = createMemo(() => {
    const result = new Map<string, TaskEntityWithProperties>();
    for (const row of rows()) {
      if (row.kind === 'entity') result.set(row.entity.id, row.entity);
    }
    return result;
  });
  const permissions = useDocumentAccessLevelsQuery(() => [...tasks().keys()]);
  const definitions = useListPropertiesQuery(() => ({
    scope: 'system',
    includeOptions: true,
  }));
  const dueDate = createMemo(() => {
    if (!definitions.isSuccess) return undefined;
    const item = definitions.data.find(
      (entry) =>
        ('definition' in entry ? entry.definition : entry).id ===
        SYSTEM_PROPERTY_IDS.DUE_DATE
    );
    if (!item) return undefined;
    const definition = 'definition' in item ? item.definition : item;
    const property = toPropertyDefinitionDomain(
      definition,
      'property_options' in item ? item.property_options : []
    );
    return property.isSystem &&
      property.owner.scope === 'system' &&
      !property.isMetadata &&
      property.valueType === 'DATE' &&
      (!property.specificEntityType || property.specificEntityType === 'TASK')
      ? property
      : undefined;
  });
  const [saving, setSaving] = createSignal<ReadonlySet<string>>(new Set());
  const save = useBulkSaveEntityPropertiesMutation();
  const canEdit = (id: string) =>
    tasks().has(id) &&
    !!dueDate() &&
    !saving().has(id) &&
    permissions.some(
      (query) =>
        query.isSuccess &&
        query.data.documentId === id &&
        (query.data.accessLevel === 'edit' ||
          query.data.accessLevel === 'owner')
    );

  return {
    canEdit,
    async saveEnd(id: string, date: Date) {
      // Read live query results again when the drag completes, not just when it starts.
      if (!canEdit(id) || !Number.isFinite(date.getTime())) {
        toast.failure('Failed to save due date');
        throw new Error('Task due date is no longer editable');
      }
      const property = dueDate();
      if (!property) {
        toast.failure('Failed to save due date');
        throw new Error('Task due date is no longer editable');
      }
      setSaving((ids) => new Set([...ids, id]));
      try {
        await save.mutateAsync({
          properties: [
            {
              entityId: id,
              entityType: 'TASK',
              property,
              apiValues: { valueType: 'DATE', value: date },
            },
          ],
        });
      } finally {
        setSaving(
          (ids) => new Set([...ids].filter((current) => current !== id))
        );
      }
    },
  };
}
