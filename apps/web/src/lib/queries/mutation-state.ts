import {
  type Mutation,
  type MutationFilters,
  type MutationState,
  type QueryClient,
  replaceEqualDeep,
  useQueryClient,
} from '@tanstack/solid-query';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from 'solid-js';

type MutationStateOptions<T> = {
  filters?: MutationFilters;
  select?: (mutation: Mutation) => T;
};

const resultOf = <T>(client: QueryClient, options: MutationStateOptions<T>) =>
  client
    .getMutationCache()
    .findAll(options.filters)
    .map((mutation) =>
      options.select ? options.select(mutation) : (mutation.state as T)
    );

/**
 * `useMutationState` and `useIsMutating` from `@tanstack/solid-query`, with
 * listeners that read nothing reactively. The mutation cache notifies
 * listeners synchronously, often while another component's computation runs
 * (a mutation's `setOptions`); the library's listeners read their own memos
 * there, so that computation keeps them, and through their owner the whole
 * unmounted view, as sources until it next runs.
 */
export function useMutationState<T = MutationState>(
  options: Accessor<MutationStateOptions<T>> = () => ({}),
  queryClient?: Accessor<QueryClient>
): Accessor<T[]> {
  const client = createMemo(() => useQueryClient(queryClient?.()));
  const [result, setResult] = createSignal(resultOf(client(), options()));
  createEffect(() => {
    const current = client();
    const unsubscribe = current.getMutationCache().subscribe(() =>
      untrack(() => {
        const next = replaceEqualDeep(result(), resultOf(current, options()));
        if (next !== result()) setResult(() => next);
      })
    );
    onCleanup(unsubscribe);
  });
  return result;
}

/** See `useMutationState`. */
export function useIsMutating(
  filters?: Accessor<MutationFilters>,
  queryClient?: Accessor<QueryClient>
): Accessor<number> {
  const client = createMemo(() => useQueryClient(queryClient?.()));
  const [count, setCount] = createSignal(client().isMutating(filters?.()));
  const unsubscribe = client()
    .getMutationCache()
    .subscribe(() => untrack(() => setCount(client().isMutating(filters?.()))));
  onCleanup(unsubscribe);
  return count;
}
