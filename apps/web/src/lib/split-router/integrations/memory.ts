import type {
  SplitRouterExternalLocation,
  SplitRouterExternalLocationValue,
} from '../types';
import { parseExternalLocation } from '../url';

export interface MemorySplitRouterLocation extends SplitRouterExternalLocation {
  history(): SplitRouterExternalLocationValue[];
  index(): number;
  back(): boolean;
  forward(): boolean;
  set(
    location: string | SplitRouterExternalLocationValue,
    options?: { replace?: boolean }
  ): void;
}

export function createMemorySplitRouterLocation(
  initial: string | SplitRouterExternalLocationValue = '/'
): MemorySplitRouterLocation {
  let entries = [parseExternalLocation(initial)];
  let currentIndex = 0;
  const listeners = new Set<
    (location: SplitRouterExternalLocationValue) => void
  >();

  const notify = () => {
    const current = entries[currentIndex]!;

    for (const listener of listeners) listener(current);
  };

  const commit = (
    location: SplitRouterExternalLocationValue,
    replace: boolean
  ) => {
    const next = parseExternalLocation(location);

    if (replace) {
      entries = entries.with(currentIndex, next);
    } else {
      entries = [...entries.slice(0, currentIndex + 1), next];
      currentIndex++;
    }

    notify();
  };

  return {
    read: () => entries[currentIndex]!,

    subscribe(listener) {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },

    commit(location, options) {
      commit(location, options.history === 'replace');
    },

    history: () => entries,
    index: () => currentIndex,

    back() {
      if (currentIndex === 0) return false;

      currentIndex--;
      notify();

      return true;
    },

    forward() {
      if (currentIndex >= entries.length - 1) return false;

      currentIndex++;
      notify();

      return true;
    },

    set(location, options = {}) {
      commit(parseExternalLocation(location), options.replace ?? false);
    },
  };
}
