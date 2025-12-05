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
    onSuccess: (data, variables, context) => {
      defaults.onSuccess?.(data, variables, context);
      overrides.onSuccess?.(data, variables, context);
    },
    onError: (error, variables, context) => {
      defaults.onError?.(error, variables, context);
      overrides.onError?.(error, variables, context);
    },
    onSettled: (data, error, variables, context) => {
      defaults.onSettled?.(data, error, variables, context);
      overrides.onSettled?.(data, error, variables, context);
    },
  };
}
