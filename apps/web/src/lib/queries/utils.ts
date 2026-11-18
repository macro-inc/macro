import { Telemetry, type TraceContext } from '@macro-inc/observability';
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
  overrides?: MutationCallbacks<TData, TError, TVariables, TContext>,
  parentFor?: (variables: TVariables) => TraceContext | undefined
): MutationCallbacks<TData, TError, TVariables, TContext> {
  if (!overrides && !parentFor) return defaults;

  return {
    onMutate: async (...args) => {
      const parent = parentFor?.(args[0]) ?? Telemetry.captureContext();
      const defaultContext = await parent.run(() =>
        defaults.onMutate?.(...args)
      );
      const overrideContext = await parent.run(() =>
        overrides?.onMutate?.(...args)
      );
      return (overrideContext ?? defaultContext) as TContext;
    },
    onSuccess: async (...args) => {
      const parent = parentFor?.(args[1]) ?? Telemetry.captureContext();
      await parent.run(() => defaults.onSuccess?.(...args));
      await parent.run(() => overrides?.onSuccess?.(...args));
    },
    onError: async (...args) => {
      const parent = parentFor?.(args[1]) ?? Telemetry.captureContext();
      await parent.run(() => defaults.onError?.(...args));
      await parent.run(() => overrides?.onError?.(...args));
    },
    onSettled: async (...args) => {
      const parent = parentFor?.(args[2]) ?? Telemetry.captureContext();
      await parent.run(() => defaults.onSettled?.(...args));
      await parent.run(() => overrides?.onSettled?.(...args));
    },
  };
}
