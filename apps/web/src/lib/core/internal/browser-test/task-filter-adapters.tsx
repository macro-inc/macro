import type { ProjectFilters } from '@app/features/projects/core/project';
import type { FacetSelection } from '@app/features/soup/filters/facets';
import type { Accessor } from 'solid-js';

export { referenceRequests } from './task-filter-people';
export {
  account,
  assertQueryAccount,
  isCurrentQueryAccount,
  setAccount,
  useQueryAccount,
} from './test-account';

import { ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { SELECTED } from './list-filter-adapters';

const initialFacets: FacetSelection = {
  status: ['in-progress'],
  assignees: [SELECTED, 'unavailable-person'],
};
export const [taskState, setTaskState] = createStore({
  facets: initialFacets,
  search: '',
  sort: [{ id: 'updated_at', reversed: false }],
  groupBy: 'priority',
  singleProject: false,
  projectsEnabled: true,
});
export const [navigation, setNavigation] = createSignal({ id: 'tasks' });
export function useTasksView() {
  return {
    state: taskState,
    setState: setTaskState,
    setFacets: (facets: FacetSelection) =>
      setTaskState('facets', reconcile(facets)),
    savedViews: { view: () => ({ kind: 'builtin' }) },
    savedViewScope: navigation,
    showProjectFilter: () =>
      !taskState.singleProject &&
      (taskState.projectsEnabled || Boolean(taskState.facets.project?.length)),
    projectsEnabled: () => taskState.projectsEnabled,
    setPrimarySort: (id: string) =>
      setTaskState('sort', [{ id, reversed: false }]),
  };
}
export function useSoupAstItemsQuery(): never {
  throw new Error(
    'Task/document loading is supplied to the inline control fixture'
  );
}
export function setTaskListSettings(): never {
  throw new Error('The inline control fixture supplies persistence');
}
export function TaskSavedViewCreateBanner() {
  return null;
}
export function TaskSavedViewActions() {
  return null;
}

export const [completionRequests, setCompletionRequests] = createSignal<
  unknown[]
>([]);
export const [completionPending, setCompletionPending] = createSignal(false);
let gate: PromiseWithResolvers<void> | undefined;
export function holdCompletion() {
  gate ??= Promise.withResolvers<void>();
}
export function releaseCompletion() {
  gate?.resolve();
  gate = undefined;
}
export async function dcsCompletion(request: {
  messages: { content: unknown }[];
}) {
  setCompletionRequests((old) => [...old, request]);
  setCompletionPending(true);
  const text = String(request.messages.at(-1)?.content ?? '');
  if (gate) await gate.promise;
  setCompletionPending(false);
  return ok({
    choices: [
      {
        message: {
          content: JSON.stringify({
            status: ['completed'],
            priority: [],
            assignees: [text],
            createdBy: [],
            tags: [],
            search: '',
            unresolved: '',
          }),
        },
      },
    ],
  });
}

export const PROJECT_A = '10000000-0000-4000-8000-000000000001';
export const PROJECT_B = '10000000-0000-4000-8000-000000000002';
const PROJECTS = [
  { id: PROJECT_A, name: 'Alpha launch' },
  { id: PROJECT_B, name: 'Beta launch' },
];

export function getGraphqlSoupClient() {
  throw new Error('Project transport is supplied by the fixture');
}
export function createProjectIdentityQuery(
  _client: unknown,
  _viewer: unknown,
  id: Accessor<string>
) {
  return {
    get isSuccess() {
      return PROJECTS.some((project) => project.id === id());
    },
    get data() {
      return PROJECTS.find((project) => project.id === id());
    },
  };
}

export function createProjectSoupSource(
  _client: unknown,
  filters: Accessor<ProjectFilters>,
  enabled: Accessor<boolean>
) {
  const [expanded, setExpanded] = createSignal(false);
  const visible = () => {
    if (!enabled()) return [];
    const search = filters().query?.toLowerCase() ?? '';
    const matches = PROJECTS.filter((project) =>
      project.name.toLowerCase().includes(search)
    );
    return expanded() || search ? matches : matches.slice(0, 1);
  };
  return {
    rows: () => visible().map((project) => ({ project, properties: [] })),
    loading: () => false,
    loadingMore: () => false,
    error: () => undefined,
    hasMore: () => enabled() && !filters().query && !expanded(),
    loadMore: async () => {
      setExpanded(true);
    },
    refresh: async () => {},
  };
}
