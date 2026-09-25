import {
  type Accessor,
  createEffect,
  createRoot,
  on,
  onCleanup,
} from 'solid-js';
import { browserEntryKeySignature } from '../entry-state';
import type {
  SplitRouterExternalLocation,
  SplitRouterExternalLocationValue,
} from '../types';
import { externalLocationToString } from '../url';

export type SolidRouterLocationOptions = {
  pathname: Accessor<string>;
  search?: Accessor<string>;
  hash?: Accessor<string>;
  state?: Accessor<unknown>;
  navigate: (
    to: string,
    options: { replace: boolean; state?: unknown }
  ) => unknown;
};

/**
 * Adapts reactive location accessors without depending on app components or
 * on a particular Solid Router location object.
 */
export function createSolidRouterLocation(
  options: SolidRouterLocationOptions
): SplitRouterExternalLocation {
  const pendingCommits = new Set<ReturnType<typeof setTimeout>>();
  let subscriptions = 0;
  const read = (): SplitRouterExternalLocationValue => {
    const location: SplitRouterExternalLocationValue = {
      pathname: options.pathname(),
      search: options.search?.() ?? '',
      hash: options.hash?.() ?? '',
    };
    if (options.state) location.state = options.state();
    return location;
  };

  return {
    read,

    subscribe(listener) {
      subscriptions += 1;
      return createRoot((dispose) => {
        onCleanup(() => {
          subscriptions -= 1;
          if (subscriptions > 0) return;
          for (const timer of pendingCommits) clearTimeout(timer);
          pendingCommits.clear();
        });
        createEffect(
          on(
            () => {
              const location = read();

              return JSON.stringify([
                location.pathname,
                location.search,
                location.hash,
                browserEntryKeySignature(location.state),
              ]);
            },
            () => listener(read()),
            { defer: true }
          )
        );

        return dispose;
      });
    },

    commit(location, commitOptions) {
      // Zone.js, used for tracing, wraps focus event handlers and can run queued
      // microtasks when those handlers finish. Navigating immediately can let
      // Solid Router's transition start before the split finishes mounting,
      // leaving onMount callbacks unrun and the preview blank. Defer navigation
      // to the next event-loop task so the current mount can finish first.
      const timer = setTimeout(() => {
        pendingCommits.delete(timer);
        options.navigate(externalLocationToString(location), {
          replace: commitOptions.history === 'replace',
          state: location.state,
        });
      }, 0);
      pendingCommits.add(timer);
    },
  };
}
