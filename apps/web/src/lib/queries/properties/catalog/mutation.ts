import { Telemetry, type TraceContext } from '@macro-inc/observability';
import { createSignal, getOwner, onCleanup } from 'solid-js';

type MaybePromise = unknown;

export type CatalogMutationCallbacks<TData, TVars> = {
  onSuccess?: (data: TData, vars: TVars) => MaybePromise;
  onError?: (error: Error, vars: TVars) => MaybePromise;
  onSettled?: (
    data: TData | undefined,
    error: Error | null,
    vars: TVars
  ) => MaybePromise;
};

export type CatalogMutation<TData, TVars> = {
  /** Runs the write; failures reach the callbacks only. */
  mutate(vars: TVars, callbacks?: CatalogMutationCallbacks<TData, TVars>): void;
  /** Runs the write and rejects when it fails. */
  mutateAsync(
    vars: TVars,
    callbacks?: CatalogMutationCallbacks<TData, TVars>
  ): Promise<TData>;
  /** Whether any write from this hook is still waiting for its outcome. */
  readonly isPending: boolean;
};

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/**
 * Binds one catalog write to a component: a pending flag plus the hook's
 * default callbacks, the caller's hook callbacks, then the call's own, in that
 * order. Once the owning component is gone, a call's own callbacks no longer
 * run (as with TanStack's `mutate` options); the hook's still do. The write
 * itself owns the cache: its optimistic layer, rollback and
 * settlement live in the GraphQL cache, not here.
 */
export function createCatalogMutation<TVars, TData>(
  run: (vars: TVars) => Promise<TData>,
  defaults: CatalogMutationCallbacks<TData, TVars>,
  callbacks?: CatalogMutationCallbacks<TData, TVars>
): CatalogMutation<TData, TVars> {
  const [pending, setPending] = createSignal(0);
  let disposed = false;
  if (getOwner()) onCleanup(() => (disposed = true));
  // Runs one callback on each layer in order. Disposal is checked before the
  // call layer runs, so an unmount during an earlier layer's await drops it.
  const eachLayer = async (
    call: CatalogMutationCallbacks<TData, TVars> | undefined,
    parent: TraceContext,
    run: (layer: CatalogMutationCallbacks<TData, TVars>) => MaybePromise
  ) => {
    for (const layer of [defaults, callbacks, call]) {
      if (!layer || (layer === call && disposed)) continue;
      await parent.run(() => run(layer));
    }
  };

  const execute = async (
    vars: TVars,
    call?: CatalogMutationCallbacks<TData, TVars>
  ): Promise<TData> => {
    // Callbacks run in the caller's trace even after the write's awaits.
    const parent: TraceContext = Telemetry.captureContext();
    setPending((count) => count + 1);
    try {
      let data: TData;
      try {
        data = await run(vars);
      } catch (cause) {
        const error = asError(cause);
        await eachLayer(call, parent, (layer) => layer.onError?.(error, vars));
        await eachLayer(call, parent, (layer) =>
          layer.onSettled?.(undefined, error, vars)
        );
        throw error;
      }
      await eachLayer(call, parent, (layer) => layer.onSuccess?.(data, vars));
      await eachLayer(call, parent, (layer) =>
        layer.onSettled?.(data, null, vars)
      );
      return data;
    } finally {
      setPending((count) => count - 1);
    }
  };

  return {
    mutate(vars, call) {
      execute(vars, call).catch(() => {
        // Reported through onError.
      });
    },
    mutateAsync: execute,
    get isPending() {
      return pending() > 0;
    },
  };
}
