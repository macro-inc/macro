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
import {
  EMPTY_TASK_FACET_CONTEXT,
  TASK_FACETS,
  type TaskFacetContext,
} from '../filters/task-facets';
import type {
  TaskDueDateFilter,
  TaskGroupBy,
  TaskReferenceScope,
  TaskSortId,
  TaskTab,
} from '../types';

type TaskAst = BackendAstNode;

/** Convert a local date string (YYYY-MM-DD) to an ISO datetime at start of day (UTC). */
const toStartOfDayISO = (dateStr: string): string =>
  new Date(`${dateStr}T00:00:00Z`).toISOString();

/** Convert a local date string (YYYY-MM-DD) to an ISO datetime at end of day (UTC). */
const toEndOfDayISO = (dateStr: string): string =>
  new Date(`${dateStr}T23:59:59.999Z`).toISOString();

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
  reference: TaskReferenceScope | undefined
): TaskAst | undefined => {
  const groups: TaskAst[] = [];
  if (compiledFacets) groups.push(compiledFacets);

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
  groupBy: TaskGroupBy
): GroupByField | undefined => {
  switch (groupBy) {
    case 'none':
      return undefined;
    case 'date':
      return { type: 'date' };
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
  /** Only tasks whose property references this entity. */
  reference?: TaskReferenceScope;
  /** Due date range filter. */
  dueDate?: TaskDueDateFilter;
};

/** Builds the concrete Soup AST used only by the production Tasks view. */
export function buildTaskQuery(
  options: BuildTaskQueryOptions
): SoupAstItemsQueryArgs {
  const primarySort = options.sort[0];
  const serverSort = primarySort?.id ?? 'updated_at';

  let sortDirection: 'asc' | 'desc' = 'desc';

  if (primarySort?.reversed) sortDirection = 'asc';

  const compiledFacets = compileFacets(
    options.facets,
    TASK_FACETS,
    options.facetContext ?? EMPTY_TASK_FACET_CONTEXT
  );

  const properties = propertyScope(
    options.tab,
    options.userId,
    compiledFacets.propf,
    options.reference
  );

  const taskDocuments = documentScope(options.tab, options.userId);

  const dueDateFilters: TaskAst[] = [];
  if (options.dueDate?.after) {
    dueDateFilters.push({ l: { tda: toStartOfDayISO(options.dueDate.after) } });
  }
  if (options.dueDate?.before) {
    dueDateFilters.push({ l: { tdb: toEndOfDayISO(options.dueDate.before) } });
  }

  const documentFilters: TaskAst[] = [taskDocuments];
  if (compiledFacets.df) documentFilters.push(compiledFacets.df);
  if (dueDateFilters.length > 0) documentFilters.push(...dueDateFilters);

  const documents = combine('&', documentFilters) ?? taskDocuments;

  const body: SoupAstBody = {
    ...nonTaskTargets,
    df: documents,
  };

  if (properties) body.propf = properties;

  return {
    params: {
      expand: true,
      limit: 100,
      sort_method: serverSort,
      sort_direction: sortDirection,
    },
    body,
    groupBy: taskGroupByField(options.groupBy),
  };
}
