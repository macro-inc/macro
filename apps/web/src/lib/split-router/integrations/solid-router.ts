import { type Accessor, createEffect, createRoot, on } from 'solid-js';
import type {
  SplitRouterExternalLocation,
  SplitRouterExternalLocationValue,
} from '../types';
import { externalLocationToString } from '../url';

export type SolidRouterLocationOptions = {
  pathname: Accessor<string>;
  search?: Accessor<string>;
  hash?: Accessor<string>;
  navigate: (to: string, options: { replace: boolean }) => unknown;
};

/**
 * Adapts reactive location accessors without depending on app components or
 * on a particular Solid Router location object.
 */
export function createSolidRouterLocation(
  options: SolidRouterLocationOptions
): SplitRouterExternalLocation {
  const read = (): SplitRouterExternalLocationValue => ({
    pathname: options.pathname(),
    search: options.search?.() ?? '',
    hash: options.hash?.() ?? '',
  });

  return {
    read,

    subscribe(listener) {
      return createRoot((dispose) => {
        createEffect(
          on(
            () => {
              const location = read();

              return JSON.stringify([
                location.pathname,
                location.search,
                location.hash,
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
      options.navigate(externalLocationToString(location), {
        replace: commitOptions.history === 'replace',
      });
    },
  };
}
