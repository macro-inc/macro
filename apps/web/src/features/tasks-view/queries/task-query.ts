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
import { match } from 'ts-pattern';
import { taskPropertySort } from '../constants';
import type {
  DateBucketBoundaries,
  TaskDatePredicate,
} from '../core/task-due-date';
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
        v: { dr: 'dateRange' in dueDate ? dueDate.dateRange : {} },
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
  pf: literal('pids', NIL_UUID),
};

export const taskGroupByField = (
  groupBy: TaskGroupBy,
  calendar?: DateBucketBoundaries
): GroupByField | undefined => {
  switch (groupBy) {
    case 'none':
      return undefined;
    case 'date':
      return { type: 'date' };
    case 'due_date':
      if (!calendar)
        throw new Error('Due-date grouping requires date-bucket boundaries');
      return {
        type: 'property',
        propertyDefinitionId: SYSTEM_PROPERTY_IDS.DUE_DATE,
        bucketing: {
          type: 'date_ranges',
          ranges: [
            { key: 'overdue', start: null, end: calendar.boundaries.today },
            {
              key: 'today',
              start: calendar.boundaries.today,
              end: calendar.boundaries.tomorrow,
            },
            {
              key: 'tomorrow',
              start: calendar.boundaries.tomorrow,
              end: calendar.boundaries.day_two,
            },
            {
              key: 'next_7_days',
              start: calendar.boundaries.day_two,
              end: calendar.boundaries.day_eight,
            },
            { key: 'later', start: calendar.boundaries.day_eight, end: null },
          ],
          missingValueBucketKey: 'no_due_date',
        },
      };
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
  calendar?: DateBucketBoundaries;
  searching?: boolean;
  /** Only tasks whose property references this entity. */
  reference?: TaskReferenceScope;
  /** Only tasks associated with this CRM record, resolved by the server. */
  crm?: TaskCrmScope;
  /** Only tasks whose name contains this text, case-insensitively. */
  nameContains?: string;
  /** Board Project columns use explicit property grouping for column editing. */
  board?: boolean;
};

/** The Soup CRM association naming the record. */
export const taskCrmAssociation = (crm: TaskCrmScope) =>
  match(crm)
    .with({ type: 'activity' }, () => 'activity' as const)
    .with({ type: 'company' }, ({ id }) => ({ company: id }))
    .with({ type: 'contact' }, ({ id }) => ({ contact: id }))
    .exhaustive(() => {
      throw new Error('Unsupported CRM task scope');
    });

/** Builds the concrete Soup AST used only by the production Tasks view. */
export function buildTaskQuery(
  options: BuildTaskQueryOptions
): SoupAstItemsQueryArgs {
  const primarySort = options.sort[0];
  const requestedSort = primarySort?.id ?? 'updated_at';
  const featureSort =
    (options.searching || options.nameContains) &&
    requestedSort.startsWith('due_date_')
      ? 'updated_at'
      : requestedSort;
  const propertySort = taskPropertySort(featureSort);
  let sortDirection: 'asc' | 'desc' = propertySort?.direction ?? 'desc';
  if (primarySort?.reversed && !featureSort.startsWith('due_date_')) {
    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
  }
  const sortMethod = match(featureSort)
    .with('updated_at', 'created_at', 'viewed_at', (sort) => sort)
    .otherwise(() => 'property' as const);
  const compiledFacets = compileFacets(options.facets, TASK_FACETS, {
    ...(options.facetContext ?? EMPTY_TASK_FACET_CONTEXT),
    viewerId: options.userId,
  });

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
      sort_method: sortMethod,
      sort_property_definition_id: propertySort?.propertyDefinitionId,
      sort_direction: sortDirection,
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
