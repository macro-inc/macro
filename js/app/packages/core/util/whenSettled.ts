import type { UseQueryResult } from '@tanstack/solid-query';
import type { Resource } from 'solid-js';
import { createEffect, createRoot, onCleanup, untrack } from 'solid-js';

type Suspendable<T> = Resource<T> | UseQueryResult<T>;

type SettledState<T> =
  | { status: 'pending' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: Error };

function getSettledState<T>(suspendable: Suspendable<T>): SettledState<T> {
  if ('loading' in suspendable && !('isSuccess' in suspendable)) {
    const resource = suspendable as Resource<T>;
    if (resource.error) {
      return { status: 'error', error: resource.error };
    }
    if (!resource.loading && resource() !== undefined) {
      return { status: 'success', data: resource()! };
    }
    return { status: 'pending' };
  }

  const query = suspendable as UseQueryResult<T>;
  if (query.isError && query.error) {
    return { status: 'error', error: query.error as Error };
  }
  if (query.isSuccess && query.data !== undefined) {
    return { status: 'success', data: query.data };
  }
  return { status: 'pending' };
}

/**
 * A helper function to run a callback ONCE when a Suspendable has settled.
 *
 * Essentially a convenience wrapper around `createEffect` calls callback once
 * once !t.eror and !t.loading are true.
 *
 * @param suspendable The Suspendable to wait for.
 * @param onSettled The callback to run once the Suspendable has settled.
 * @param onError The callback to run if the Suspendable fails.
 * @returns A function that can be called to cancel the callback.
 */
export function whenSettled<T>(
  suspendable: Suspendable<T>,
  onSettled: (data: T) => void,
  onError?: (error: Error) => void
): () => void {
  let dispose: (() => void) | undefined;

  createRoot((d) => {
    dispose = d;

    createEffect(() => {
      const state = getSettledState(suspendable);

      if (state.status === 'pending') return;

      untrack(() => {
        if (state.status === 'error') {
          onError?.(state.error);
        } else {
          onSettled(state.data);
        }
      });
      d();
    });
  });

  onCleanup(() => dispose?.());

  return () => dispose?.();
}

