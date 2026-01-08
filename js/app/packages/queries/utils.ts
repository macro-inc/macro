import type { MutationOptions } from '@tanstack/solid-query';

/**
 * Standard mutation callback types matching TanStack Query's mutation options.
 * Use this to ensure consistent callback signatures across mutations.
 */
export type MutationCallbacks<
  TData,
  TError = Error,
  TVariables = void,
  TContext = unknown,
> = Pick<
  MutationOptions<TData, TError, TVariables, TContext>,
  'onMutate' | 'onError' | 'onSuccess' | 'onSettled'
>;

/**
 * Helper to merge user-provided callbacks with default mutation behavior.
 * Ensures callbacks are called in order: defaults first, then user callbacks.
 *
 * For onMutate: default runs first, override can augment the context.
 * For onSuccess/onError/onSettled: default runs first, then override.
 */
export function withCallbacks<
  TData,
  TError = Error,
  TVariables = void,
  TContext = unknown,
>(
  defaults: MutationCallbacks<TData, TError, TVariables, TContext>,
  overrides?: MutationCallbacks<TData, TError, TVariables, TContext>
): MutationCallbacks<TData, TError, TVariables, TContext> {
  if (!overrides) return defaults;

  return {
    onMutate: async (...args) => {
      const defaultContext = await defaults.onMutate?.(...args);
      const overrideContext = await overrides.onMutate?.(...args);
      return (overrideContext ?? defaultContext) as TContext;
    },
    onSuccess: async (...args) => {
      await defaults.onSuccess?.(...args);
      await overrides.onSuccess?.(...args);
    },
    onError: async (...args) => {
      await defaults.onError?.(...args);
      await overrides.onError?.(...args);
    },
    onSettled: async (...args) => {
      await defaults.onSettled?.(...args);
      await overrides.onSettled?.(...args);
    },
  };
}
