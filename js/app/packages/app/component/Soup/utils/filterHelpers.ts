import {
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '@core/component/Properties/constants';
import type { TaskEntity } from '@macro-entity';
import type { SoupProperty } from '@service-storage/generated/schemas';
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
 * Task entity with properties from the DSS query (properties are spread from item.data)
 */
export type TaskEntityWithProperties = TaskEntity & {
  properties?: SoupProperty[];
};

/**
 * Extracts assignee user IDs from task properties.
 * Assignees are stored as EntityReference values in the ASSIGNEES property.
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

  // Assignees use EntityReference type with value as an array of references
  const value = assigneesProperty.value;
  if (value.type === 'EntityReference' && Array.isArray(value.value)) {
    return value.value
      .filter((ref) => ref.entity_type === 'USER')
      .map((ref) => ref.entity_id);
  }

  return [];
};

/**
 * Gets the status option ID from task properties.
 * Status is stored as a SelectOption with value as an array of UUIDs (single-select has 0-1 items).
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

  // Status uses SelectOption type with value as array of option IDs
  const value = statusProperty.value;
  if (
    value.type === 'SelectOption' &&
    'value' in value &&
    Array.isArray(value.value)
  ) {
    // Single-select status returns first option ID (if any)
    return value.value[0];
  }

  return undefined;
};

/**
 * Checks if a task is in a "closed" state (completed or canceled).
 */
export const isTaskClosed = (entity: TaskEntityWithProperties): boolean => {
  // First check the is_completed flag from subType (most reliable)
  if (entity.subType?.is_completed === true) {
    return true;
  }

  // Also check status property for CANCELED status
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
 * Checks if the current user is assigned to the task.
 */
export const isCurrentUserAssigned = (
  entity: TaskEntityWithProperties,
  currentUserId: string | undefined
): boolean => {
  if (!currentUserId) return false;

  const assigneeIds = getTaskAssigneeIds(entity);

  // If no assignees, consider user assigned (show unassigned tasks)
  if (assigneeIds.length === 0) return true;

  return assigneeIds.includes(currentUserId);
};

/**
 * Determines if a task should appear in the Signal tab.
 * Tasks appear in Signal if:
 * - They are not completed or canceled
 * - The current user is an assignee (or the task has no assignees)
 */
export const isSignalTask = (
  entity: TaskEntityWithProperties,
  currentUserId: string | undefined
): boolean => {
  // Exclude closed tasks (completed or canceled)
  if (isTaskClosed(entity)) {
    return false;
  }

  // Include tasks where current user is assigned (or unassigned tasks)
  return isCurrentUserAssigned(entity, currentUserId);
};
