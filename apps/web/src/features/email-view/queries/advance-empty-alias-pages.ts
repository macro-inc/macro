import { fireAndForget } from '@core/util/fireAndForget';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
  untrack,
} from 'solid-js';

/** Alias membership is resolved by GraphQL after search/reminder candidate
 * pages arrive. Advance empty slices automatically, waiting for membership and
 * stopping on a match, exhaustion, errors, or a change of view. */
export function advanceEmptyAliasPages(options: {
  scope: Accessor<string>;
  enabled: Accessor<boolean>;
  ready: Accessor<boolean>;
  hasItems: Accessor<boolean>;
  hasNextPage: Accessor<boolean>;
  loadMore: () => Promise<unknown>;
}) {
  const [running, setRunning] = createSignal(false);
  const [failure, setFailure] = createSignal<{ scope: string; error: Error }>();
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const error = () =>
    failure()?.scope === options.scope() ? failure()?.error : undefined;

  async function advance(scope: string) {
    setRunning(true);
    try {
      await options.loadMore();
    } catch (cause) {
      if (!disposed)
        setFailure({
          scope,
          error:
            cause instanceof Error
              ? cause
              : new Error('Email could not be loaded'),
        });
    } finally {
      if (!disposed) setRunning(false);
    }
  }

  createEffect(
    on(
      [
        options.scope,
        options.enabled,
        options.ready,
        options.hasItems,
        options.hasNextPage,
        running,
        error,
      ],
      ([scope, enabled, ready, hasItems, hasNextPage, busy, failed]) => {
        if (failure() && failure()?.scope !== scope) setFailure(undefined);
        if (enabled && ready && !hasItems && hasNextPage && !busy && !failed) {
          untrack(() => fireAndForget(advance(scope), 'email-view'));
        }
      }
    )
  );

  return {
    isFetching: running,
    error,
    resetError: () => setFailure(undefined),
  };
}
