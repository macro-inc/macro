import {
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '@core/component/Properties/constants';
import type { TaskEntityWithProperties } from '@macro-entity';
import type { ExpandedEntityType } from '@macro-entity';
import type { DocumentTypeFilter } from '../../ViewConfig';

/**
 * Pure helper for set equality comparison.
 */
export const sameSet = <T>(a: readonly T[], b: readonly T[]): boolean => {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((x) => setA.has(x));
};

/**
 * Pure predicate: is a specific document preset filter active?
 * Checks if typeFilter is exactly ['document'] and documentTypeFilter matches targetTypes.
 */
export const isDocumentPresetActive = (
  typeFilter: readonly ExpandedEntityType[],
  documentTypeFilter: readonly DocumentTypeFilter[],
  targetTypes: readonly DocumentTypeFilter[]
): boolean => {
  if (typeFilter.length !== 1 || typeFilter[0] !== 'document') return false;
  return sameSet(documentTypeFilter, targetTypes);
};

/**
 * Pure predicate: is a specific channel category filter active?
 * Checks if typeFilter includes 'channel' and categoryFilter is exactly [targetCategory].
 */
export const isChannelCategoryActive = (
  typeFilter: readonly ExpandedEntityType[],
  categoryFilter: readonly ('people' | 'groups')[],
  targetCategory: 'people' | 'groups'
): boolean => {
  if (typeFilter.length !== 1 || typeFilter[0] !== 'channel') return false;
  return categoryFilter.length === 1 && categoryFilter[0] === targetCategory;
};

/**
 * Pure predicate: is a specific entity type filter active (exclusive)?
 * Checks if typeFilter is exactly [type].
 */
export const isEntityTypeFilterActive = (
  typeFilter: readonly ExpandedEntityType[],
  type: ExpandedEntityType
): boolean => {
  return typeFilter.length === 1 && typeFilter[0] === type;
};

/**
 * Pure predicate: is a focus filter (signal/noise) active?
 * Signal = Inbox, Noise = Other.
 */
export const isFocusFilterActive = (
  focusFilters: readonly ('signal' | 'noise')[] | undefined,
  target: 'signal' | 'noise'
): boolean => {
  if (!focusFilters || focusFilters.length === 0) return false;
  // Inbox active means signal is in list and noise is not
  // Other active means noise is in list and signal is not
  const hasTarget = focusFilters.includes(target);
  const opposite = target === 'signal' ? 'noise' : 'signal';
  const hasOpposite = focusFilters.includes(opposite);
  return hasTarget && !hasOpposite;
};

/**
 * extracts assignee user ids from task properties.
 */
export const getTaskAssigneeIds = (
  entity: TaskEntityWithProperties
): string[] => {
  const properties = entity.properties;
  if (!properties) return [];
  const assigneesProperty = properties.find(
    (p) => p.definition.id === SYSTEM_PROPERTY_IDS.ASSIGNEES
  );
  if (!assigneesProperty?.value) return [];

  const value = assigneesProperty.value;
  if (value.type === 'EntityReference' && Array.isArray(value.value)) {
    return value.value
      .filter((ref) => ref.entity_type === 'USER')
      .map((ref) => ref.entity_id);
  }

  return [];
};

/**
 * gets the status option id from task properties.
 */
export const getTaskStatusOptionId = (
  entity: TaskEntityWithProperties
): string | undefined => {
  const properties = entity.properties;
  if (!properties) return undefined;

  const statusProperty = properties.find(
    (p) => p.definition.id === SYSTEM_PROPERTY_IDS.STATUS
  );
  if (!statusProperty?.value) return undefined;

  const value = statusProperty.value;
  if (
    value.type === 'SelectOption' &&
    'value' in value &&
    Array.isArray(value.value)
  ) {
    return value.value[0];
  }

  return undefined;
};

/**
 * checks if a task is in a "closed" state (completed or canceled).
 */
export const isTaskClosed = (entity: TaskEntityWithProperties): boolean => {
  if (entity.subType?.is_completed === true) {
    return true;
  }
  const statusOptionId = getTaskStatusOptionId(entity);
  if (
    statusOptionId === PROPERTY_OPTION_IDS.STATUS.COMPLETED ||
    statusOptionId === PROPERTY_OPTION_IDS.STATUS.CANCELED
  ) {
    return true;
  }
  return false;
};

/**
 * checks if the current user is assigned to the task.
 */
export const isCurrentUserAssigned = (
  entity: TaskEntityWithProperties,
  currentUserId: string | undefined
): boolean => {
  if (!currentUserId) return false;
  const assigneeIds = getTaskAssigneeIds(entity);
  if (assigneeIds.length === 0) return true;
  return assigneeIds.includes(currentUserId);
};

/**
 * determines if a task should appear in the signal tab.
 * tasks appear in signal if:
 * - they are not completed or canceled
 * - the current user is an assignee (or the task has no assignees)
 */
export const isSignalTask = (
  entity: TaskEntityWithProperties,
  currentUserId: string | undefined
): boolean => {
  if (isTaskClosed(entity)) {
    return false;
  }
  return isCurrentUserAssigned(entity, currentUserId);
};
