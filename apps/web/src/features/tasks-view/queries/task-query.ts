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
import type { TaskGroupBy, TaskSortId, TaskTab } from '../types';

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
  compiledFacets: TaskAst | undefined
): TaskAst | undefined => {
  const groups: TaskAst[] = [];
  if (compiledFacets) groups.push(compiledFacets);

  if (tab === 'my-tasks' && userId) {
    groups.push(entityPropertyLiteral(SYSTEM_PROPERTY_IDS.ASSIGNEES, userId));
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
  /** Authorized membership scope; an empty set deliberately matches no tasks. */
  taskIds?: readonly string[];
};

const membershipScope = (ids: readonly string[]): TaskAst => {
  if (!ids.length) return literal('id', NIL_UUID);
  // A project may contain thousands of tasks. Balance the binary AST to stay
  // below the JSON parser's recursion limit while keeping every membership ID.
  let level = ids.map((id) => literal('id', id));
  while (level.length > 1) {
    const next: TaskAst[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const right = level[index + 1];
      next.push(right ? { '|': [level[index], right] } : level[index]);
    }
    level = next;
  }
  return level[0];
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
    compiledFacets.propf
  );

  const taskDocuments = documentScope(options.tab, options.userId);

  let documents: TaskAst = compiledFacets.df
    ? { '&': [taskDocuments, compiledFacets.df] }
    : taskDocuments;
  if (options.taskIds !== undefined) {
    documents = { '&': [documents, membershipScope(options.taskIds)] };
  }

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
