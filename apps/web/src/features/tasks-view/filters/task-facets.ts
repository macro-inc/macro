import {
  clause,
  type Facet,
  type FacetClause,
  type FacetOption,
  type FacetSelection,
  resolveFacetOption,
} from '@app/features/soup';
import type { TaskEntityWithProperties } from '@entity/types/entity';
import {
  getTaskAssigneeIds,
  getTaskPriorityOptionId,
  getTaskStatusOptionId,
} from '@entity/utils/task-properties';
import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';

export type TaskFacetContext = {
  tagPropertyDefinitionByOptionId: ReadonlyMap<string, string>;
};

export const EMPTY_TASK_FACET_CONTEXT: TaskFacetContext = {
  tagPropertyDefinitionByOptionId: new Map(),
};

export type TaskFacetOption = FacetOption<
  TaskEntityWithProperties,
  TaskFacetContext
> & {
  label?: string;
  propertyDefinitionId?: string;
  propertyOptionId?: string;
  propertyEntityId?: string;
};

type TaskPropertyFacetOption = TaskFacetOption & {
  label: string;
  propertyDefinitionId: string;
  propertyOptionId: string;
};

const propertyClause = (
  propertyDefinitionId: string,
  type: 'select' | 'entity',
  value: string
): FacetClause => ({
  propf: clause.eq('properties', {
    propertyId: propertyDefinitionId,
    type,
    value,
  }),
});

const statusOption = (
  id: string,
  label: string,
  propertyOptionId: string
): TaskPropertyFacetOption => ({
  id,
  label,
  propertyDefinitionId: SYSTEM_PROPERTY_IDS.STATUS,
  propertyOptionId,
  clause: propertyClause(
    SYSTEM_PROPERTY_IDS.STATUS,
    'select',
    propertyOptionId
  ),
  predicate: (task) => getTaskStatusOptionId(task) === propertyOptionId,
});

const priorityOption = (
  id: string,
  label: string,
  propertyOptionId: string
): TaskPropertyFacetOption => ({
  id,
  label,
  propertyDefinitionId: SYSTEM_PROPERTY_IDS.PRIORITY,
  propertyOptionId,
  clause: propertyClause(
    SYSTEM_PROPERTY_IDS.PRIORITY,
    'select',
    propertyOptionId
  ),
  predicate: (task) => getTaskPriorityOptionId(task) === propertyOptionId,
});

const assigneeOption = (id: string): TaskFacetOption => ({
  id,
  propertyDefinitionId: SYSTEM_PROPERTY_IDS.ASSIGNEES,
  propertyEntityId: id,
  clause: propertyClause(SYSTEM_PROPERTY_IDS.ASSIGNEES, 'entity', id),
  predicate: (task) => getTaskAssigneeIds(task).includes(id),
});

const creatorOption = (id: string): TaskFacetOption => ({
  id,
  clause: { df: clause.eq('documentOwnerId', id) },
  predicate: (task) => task.ownerId === id,
});

const taskHasSelectOption = (
  task: TaskEntityWithProperties,
  optionId: string
) =>
  task.properties?.some(
    (property) =>
      property.value?.type === 'SelectOption' &&
      property.value.value.includes(optionId)
  ) ?? false;

const tagOption = (
  id: string,
  context: TaskFacetContext
): TaskFacetOption | undefined => {
  const propertyDefinitionId = context.tagPropertyDefinitionByOptionId.get(id);
  if (!propertyDefinitionId) return undefined;

  return {
    id,
    propertyDefinitionId,
    propertyOptionId: id,
    clause: propertyClause(propertyDefinitionId, 'select', id),
    predicate: (task) => taskHasSelectOption(task, id),
  };
};

export const TASK_STATUS_OPTIONS = [
  statusOption(
    'not-started',
    'Not started',
    PROPERTY_OPTION_IDS.STATUS.NOT_STARTED
  ),
  statusOption(
    'in-progress',
    'In progress',
    PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS
  ),
  statusOption('in-review', 'In review', PROPERTY_OPTION_IDS.STATUS.IN_REVIEW),
  statusOption('completed', 'Completed', PROPERTY_OPTION_IDS.STATUS.COMPLETED),
  statusOption('canceled', 'Canceled', PROPERTY_OPTION_IDS.STATUS.CANCELED),
];

export const TASK_PRIORITY_OPTIONS = [
  priorityOption('urgent', 'Urgent', PROPERTY_OPTION_IDS.PRIORITY.URGENT),
  priorityOption('high', 'High', PROPERTY_OPTION_IDS.PRIORITY.HIGH),
  priorityOption('medium', 'Medium', PROPERTY_OPTION_IDS.PRIORITY.MEDIUM),
  priorityOption('low', 'Low', PROPERTY_OPTION_IDS.PRIORITY.LOW),
];

export const TASK_FACETS: Facet<
  TaskEntityWithProperties,
  TaskFacetContext,
  TaskFacetOption
>[] = [
  { id: 'status', mode: 'or', options: TASK_STATUS_OPTIONS },
  { id: 'priority', mode: 'or', options: TASK_PRIORITY_OPTIONS },
  { id: 'assignees', mode: 'or', options: assigneeOption },
  { id: 'created-by', mode: 'or', options: creatorOption },
  { id: 'tags', mode: 'or', options: tagOption },
];

export const DEFAULT_TASK_FACET_SELECTION: FacetSelection = {
  status: ['in-progress', 'in-review', 'not-started'],
};

export const getTaskFacetOption = (
  facetId: string,
  optionId: string,
  context: TaskFacetContext
): TaskFacetOption | undefined => {
  const facet = TASK_FACETS.find((candidate) => candidate.id === facetId);
  if (!facet) return undefined;
  return resolveFacetOption(facet, optionId, context);
};
