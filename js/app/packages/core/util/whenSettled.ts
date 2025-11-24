import { createEffect, createRoot, onCleanup, untrack } from 'solid-js';
import type { Resource } from 'solid-js';
import type { UseQueryResult } from '@tanstack/solid-query';

type Suspendable<T> = Resource<T> | UseQueryResult<T>;

export function whenSettled<T>(
  suspendable: Suspendable<T>,
  onData: (data: T) => void,
  onError?: (error: Error) => void
) {
  let disposeFn: (() => void) | undefined;
  createRoot((dispose) => {
    disposeFn = dispose;
    createEffect(
      (prevState) => {
        // Handle Resource
        if ('loading' in suspendable) {
          const resource = suspendable as Resource<T>;

          if (!resource.loading && resource() !== undefined) {
            if (prevState !== 'success') {
              untrack(() => onData(resource()!));
              dispose();
            }
            return 'success';
          }

          if (resource.error && prevState !== 'error') {
            if (onError) {
              untrack(() => onError(resource.error));
            }
            return 'error';
          }

          return prevState;
        }

        const query = suspendable as UseQueryResult<T>;

        if (query.isSuccess && query.data !== undefined) {
          if (prevState !== 'success') {
            untrack(() => onData(query.data));
            dispose();
          }
          return 'success';
        }

        if (query.isError && query.error) {
          if (prevState !== 'error') {
            if (onError) {
              untrack(() => onError(query.error as Error));
              dispose();
            }
          }
          return 'error';
        }

        return prevState;
      },
      undefined as 'success' | 'error' | undefined
    );
  });

  onCleanup(() => {
    disposeFn?.();
  });
}
