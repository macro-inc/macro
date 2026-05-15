import {
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '@core/component/Properties/constants';
import type { TaskEntityWithProperties } from '../types/entity';

export const TASK_STATUS_OPTIONS = [
  { value: PROPERTY_OPTION_IDS.STATUS.NOT_STARTED, label: 'Not Started' },
  { value: PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS, label: 'In Progress' },
  { value: PROPERTY_OPTION_IDS.STATUS.IN_REVIEW, label: 'In Review' },
  { value: PROPERTY_OPTION_IDS.STATUS.COMPLETED, label: 'Completed' },
  { value: PROPERTY_OPTION_IDS.STATUS.CANCELED, label: 'Canceled' },
] as const;

export const TASK_PRIORITY_OPTIONS = [
  { value: PROPERTY_OPTION_IDS.PRIORITY.URGENT, label: 'Urgent' },
  { value: PROPERTY_OPTION_IDS.PRIORITY.HIGH, label: 'High' },
  { value: PROPERTY_OPTION_IDS.PRIORITY.MEDIUM, label: 'Medium' },
  { value: PROPERTY_OPTION_IDS.PRIORITY.LOW, label: 'Low' },
] as const;

const PROPERTY_OPTION_LABELS: Record<string, string> = {
  ...Object.fromEntries(TASK_STATUS_OPTIONS.map((o) => [o.value, o.label])),
  ...Object.fromEntries(TASK_PRIORITY_OPTIONS.map((o) => [o.value, o.label])),
};

export const getPropertyOptionLabel = (
  optionId: string
): string | undefined => {
  return PROPERTY_OPTION_LABELS[optionId];
};

const getTaskPropertyByDefinitionId = (
  entity: TaskEntityWithProperties,
  definitionId: string
) => {
  return entity.properties?.find((property) => {
    return property.definition.id === definitionId;
  });
};

const isStringArray = (value: unknown): value is string[] => {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
};

const isEntityReferenceArray = (
  value: unknown
): value is Array<{ entity_type: string; entity_id: string }> => {
  return (
    Array.isArray(value) &&
    value.every((item) => {
      return (
        typeof item === 'object' &&
        item !== null &&
        'entity_type' in item &&
        'entity_id' in item &&
        typeof item.entity_type === 'string' &&
        typeof item.entity_id === 'string'
      );
    })
  );
};

/**
 * Extracts assignee user ids from task properties.
 */
export const getTaskAssigneeIds = (
  entity: TaskEntityWithProperties
): string[] => {
  const assigneesProperty = getTaskPropertyByDefinitionId(
    entity,
    SYSTEM_PROPERTY_IDS.ASSIGNEES
  );

  if (!assigneesProperty?.value) {
    return [];
  }

  const value = assigneesProperty.value;
  if (
    value.type !== 'EntityReference' ||
    !isEntityReferenceArray(value.value)
  ) {
    return [];
  }

  return value.value
    .filter((reference) => reference.entity_type === 'USER')
    .map((reference) => reference.entity_id);
};

/**
 * Gets the status option id from task properties.
 */
export const getTaskStatusOptionId = (
  entity: TaskEntityWithProperties
): string | undefined => {
  const statusProperty = getTaskPropertyByDefinitionId(
    entity,
    SYSTEM_PROPERTY_IDS.STATUS
  );

  if (!statusProperty?.value) {
    return undefined;
  }

  const value = statusProperty.value;
  if (value.type !== 'SelectOption' || !isStringArray(value.value)) {
    return undefined;
  }

  return value.value[0];
};

/**
 * Gets the priority option id from task properties.
 */
export const getTaskPriorityOptionId = (
  entity: TaskEntityWithProperties
): string | undefined => {
  const priorityProperty = getTaskPropertyByDefinitionId(
    entity,
    SYSTEM_PROPERTY_IDS.PRIORITY
  );

  if (!priorityProperty?.value) {
    return undefined;
  }

  const value = priorityProperty.value;
  if (value.type !== 'SelectOption' || !isStringArray(value.value)) {
    return undefined;
  }

  return value.value[0];
};

/**
 * Checks if a task is in a closed state.
 */
export const isTaskClosed = (entity: TaskEntityWithProperties): boolean => {
  if (entity.subType?.is_completed === true) {
    return true;
  }

  const statusOptionId = getTaskStatusOptionId(entity);
  return (
    statusOptionId === PROPERTY_OPTION_IDS.STATUS.COMPLETED ||
    statusOptionId === PROPERTY_OPTION_IDS.STATUS.CANCELED
  );
};

/**
 * Checks if the current user is assigned to the task.
 * If a task has no assignees, it is treated as visible to everyone.
 */
export const isCurrentUserAssigned = (
  entity: TaskEntityWithProperties,
  currentUserId: string | undefined
): boolean => {
  if (!currentUserId) {
    return false;
  }

  const assigneeIds = getTaskAssigneeIds(entity);
  if (assigneeIds.length === 0) {
    return true;
  }

  return assigneeIds.includes(currentUserId);
};
