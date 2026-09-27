import {
  type Accessor,
  createEffect,
  createRoot,
  on,
  onCleanup,
  untrack,
} from 'solid-js';
import { externalLocationSignature } from '../location-sync';
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
  const dispatchedCommits: string[] = [];
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
  let observedSignature = externalLocationSignature(untrack(read));
  const cancelPendingCommits = () => {
    for (const timer of pendingCommits) clearTimeout(timer);
    pendingCommits.clear();
  };

  return {
    read,

    subscribe(listener) {
      if (subscriptions === 0) {
        // The location may have changed while no subscribers were observing it.
        observedSignature = externalLocationSignature(untrack(read));
      }
      subscriptions += 1;
      return createRoot((dispose) => {
        onCleanup(() => {
          subscriptions -= 1;
          if (subscriptions > 0) return;
          cancelPendingCommits();
          dispatchedCommits.length = 0;
        });
        createEffect(
          on(
            () => externalLocationSignature(read()),
            (signature) => {
              // Process each change once even when several subscribers observe it.
              if (signature !== observedSignature) {
                observedSignature = signature;
                const index = dispatchedCommits.lastIndexOf(signature);
                if (index >= 0) {
                  // An echo of our own navigation must not cancel newer writes.
                  dispatchedCommits.splice(0, index + 1);
                } else {
                  // Back/Forward or another navigator supersedes queued writes.
                  cancelPendingCommits();
                  dispatchedCommits.length = 0;
                }
              }
              listener(read());
            },
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
        dispatchedCommits.push(externalLocationSignature(location));
        options.navigate(externalLocationToString(location), {
          replace: commitOptions.history === 'replace',
          state: location.state,
        });
      }, 0);
      pendingCommits.add(timer);
    },
  };
}
