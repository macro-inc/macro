import {
  type BackendAstNode,
  combine,
  compileFacets,
  type FacetSelection,
  literal,
  NIL_UUID,
  type SortSelection,
} from '@app/features/soup';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import type { GroupByField } from '@queries/soup/grouped/types';
import type { SoupAstBody, SoupAstItemsQueryArgs } from '@queries/soup/items';
import type { TaskCalendar, TaskDatePredicate } from '../core/task-due-date';
import {
  EMPTY_TASK_FACET_CONTEXT,
  TASK_FACETS,
  type TaskFacetContext,
} from '../filters/task-facets';
import type {
  TaskCrmScope,
  TaskGroupBy,
  TaskReferenceScope,
  TaskSortId,
  TaskTab,
} from '../types';

type TaskAst = BackendAstNode;

const entityPropertyLiteral = (
  definitionId: string,
  entityId: string
): TaskAst => ({
  l: { pd: definitionId, v: { er: entityId } },
});

const documentScope = (tab: TaskTab, userId: string | undefined): TaskAst => {
  const task = literal('dst', 'task');
  if ((tab === 'my-tasks' || tab === 'created-by-me') && !userId) {
    return literal('id', NIL_UUID);
  }
  if (tab === 'created-by-me') {
    return { '&': [task, literal('o', userId)] };
  }

  return task;
};

const propertyScope = (
  tab: TaskTab,
  userId: string | undefined,
  compiledFacets: TaskAst | undefined,
  reference: TaskReferenceScope | undefined,
  dueDate?: TaskDatePredicate
): TaskAst | undefined => {
  const groups: TaskAst[] = [];
  if (compiledFacets) groups.push(compiledFacets);
  if (dueDate) {
    const value: TaskAst = {
      l: {
        pd: SYSTEM_PROPERTY_IDS.DUE_DATE,
        et: 'TASK',
        v: 'dateRange' in dueDate ? { dr: dueDate.dateRange } : 'dp',
      },
    };
    groups.push(
      'hasDate' in dueDate && !dueDate.hasDate ? { '!': value } : value
    );
  }

  if (tab === 'my-tasks' && userId) {
    groups.push(entityPropertyLiteral(SYSTEM_PROPERTY_IDS.ASSIGNEES, userId));
  }
  if (reference) {
    groups.push(
      entityPropertyLiteral(reference.propertyDefinitionId, reference.entityId)
    );
  }

  return combine('&', groups);
};

const nonTaskTargets = {
  calf: literal('id', NIL_UUID),
  callf: literal('CallId', NIL_UUID),
  ccf: literal('id', NIL_UUID),
  cf: literal('cid', NIL_UUID),
  chanf: literal('ChannelId', NIL_UUID),
  cthf: literal('ThreadId', NIL_UUID),
  ef: literal('ThreadId', NIL_UUID),
  fef: literal('id', NIL_UUID),
  pf: literal('pid', NIL_UUID),
};

export const taskGroupByField = (
  groupBy: TaskGroupBy,
  calendar?: TaskCalendar
): GroupByField | undefined => {
  switch (groupBy) {
    case 'none':
      return undefined;
    case 'date':
      return { type: 'date' };
    case 'due_date':
      if (!calendar)
        throw new Error('Due-date grouping requires a calendar snapshot');
      return { type: 'deadline', boundaries: calendar.boundaries };
    case 'project':
      return { type: 'project' };
    case 'status':
      return {
        type: 'property',
        propertyDefinitionId: SYSTEM_PROPERTY_IDS.STATUS,
      };
    case 'priority':
      return {
        type: 'property',
        propertyDefinitionId: SYSTEM_PROPERTY_IDS.PRIORITY,
      };
    case 'assignee':
      return {
        type: 'property',
        propertyDefinitionId: SYSTEM_PROPERTY_IDS.ASSIGNEES,
      };
  }
};

export type BuildTaskQueryOptions = {
  tab: TaskTab;
  userId: string | undefined;
  facets: FacetSelection;
  facetContext?: TaskFacetContext;
  groupBy: TaskGroupBy;
  sort: SortSelection<TaskSortId>[];
  dueDate?: TaskDatePredicate;
  calendar?: TaskCalendar;
  searching?: boolean;
  /** Only tasks whose property references this entity. */
  reference?: TaskReferenceScope;
  /** Only tasks associated with this CRM record, resolved by the server. */
  crm?: TaskCrmScope;
  /** Only tasks whose name contains this text, case-insensitively. */
  nameContains?: string;
  /** Board Project columns use the initiative property, not legacy folders. */
  board?: boolean;
};

/** The Soup CRM association naming the record. */
export const taskCrmAssociation = (crm: TaskCrmScope) =>
  crm.type === 'company' ? { company: crm.id } : { contact: crm.id };

/** Builds the concrete Soup AST used only by the production Tasks view. */
export function buildTaskQuery(
  options: BuildTaskQueryOptions
): SoupAstItemsQueryArgs {
  const primarySort = options.sort[0];
  const requestedSort = primarySort?.id ?? 'updated_at';
  const serverSort =
    (options.searching || options.nameContains) &&
    requestedSort.startsWith('due_date_')
      ? 'updated_at'
      : requestedSort;

  let sortDirection: 'asc' | 'desc' = 'desc';

  if (primarySort?.reversed && !serverSort.startsWith('due_date_'))
    sortDirection = 'asc';

  const compiledFacets = compileFacets(
    options.facets,
    TASK_FACETS,
    options.facetContext ?? EMPTY_TASK_FACET_CONTEXT
  );

  const properties = propertyScope(
    options.tab,
    options.userId,
    compiledFacets.propf,
    options.reference,
    options.dueDate
  );

  const taskDocuments = documentScope(options.tab, options.userId);

  const documents =
    combine(
      '&',
      [
        taskDocuments,
        compiledFacets.df,
        options.nameContains ? literal('nc', options.nameContains) : undefined,
      ].filter((node): node is TaskAst => node !== undefined)
    ) ?? taskDocuments;

  const body: SoupAstBody = {
    ...nonTaskTargets,
    df: documents,
  };

  if (properties) body.propf = properties;
  if (options.crm) body.crma = taskCrmAssociation(options.crm);

  return {
    params: {
      expand: true,
      limit: 100,
      sort_method: serverSort,
      sort_direction: serverSort.startsWith('due_date_')
        ? undefined
        : sortDirection,
    },
    body,
    groupBy:
      options.board && options.groupBy === 'project'
        ? {
            type: 'property',
            propertyDefinitionId: SYSTEM_PROPERTY_IDS.PROJECT,
          }
        : taskGroupByField(options.groupBy, options.calendar),
  };
}
