import type { TaskEntityWithProperties } from '@entity';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';

/** Timeline dates come from the existing task payload, not another query. */
export function taskGanttDates(task: TaskEntityWithProperties) {
  const due = task.properties?.find(
    (property) => property.definition.id === SYSTEM_PROPERTY_IDS.DUE_DATE
  )?.value;

  return {
    start: task.createdAt,
    end: due?.type === 'Date' ? due.value : undefined,
  };
}
