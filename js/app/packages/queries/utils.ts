/**
 * Standard mutation callback types matching TanStack Query's mutation options.
 * Use this to ensure consistent callback signatures across mutations.
 */
export type MutationCallbacks<
  TData,
  TError = Error,
  TVariables = void,
  TContext = unknown,
> = {
  onMutate?: (variables: TVariables) => Promise<TContext> | TContext;
  onSuccess?: (
    data: TData,
    variables: TVariables,
    context: TContext
  ) => void | Promise<unknown>;
  onError?: (
    error: TError,
    variables: TVariables,
    context: TContext | undefined
  ) => void | Promise<unknown>;
  onSettled?: (
    data: TData | undefined,
    error: TError | null,
    variables: TVariables,
    context: TContext | undefined
  ) => void | Promise<unknown>;
};

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
    onMutate: async (variables) => {
      const defaultContext = await defaults.onMutate?.(variables);
      const overrideContext = await overrides.onMutate?.(variables);
      return (overrideContext ?? defaultContext) as TContext;
    },
    onSuccess: async (data, variables, context) => {
      await defaults.onSuccess?.(data, variables, context);
      await overrides.onSuccess?.(data, variables, context);
    },
    onError: async (error, variables, context) => {
      await defaults.onError?.(error, variables, context);
      await overrides.onError?.(error, variables, context);
    },
    onSettled: async (data, error, variables, context) => {
      await defaults.onSettled?.(data, error, variables, context);
      await overrides.onSettled?.(data, error, variables, context);
    },
  };
}
