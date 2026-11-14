import type { FacetSelection } from '@app/features/soup/filters/facets';

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
    source: { sortsSearchResults: false },
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
