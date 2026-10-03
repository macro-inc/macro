import { browserEntryKeySignature } from './entry-state';
import type { SplitRoutesManifest } from './routes';
import type {
  BrowserHistoryIntent,
  SplitRouterEntry,
  SplitRouterExternalLocation,
  SplitRouterExternalLocationValue,
} from './types';
import { encodeSplitRouterLocation } from './url';

export function externalLocationSignature(
  location: SplitRouterExternalLocationValue
): string {
  const query = [...new URLSearchParams(location.search)].sort(
    ([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey === rightKey) return leftValue.localeCompare(rightValue);
      return leftKey.localeCompare(rightKey);
    }
  );
  let pathname = location.pathname || '/';
  if (location.pathname.length > 1) {
    pathname = location.pathname.replace(/\/+$/g, '');
  }

  return JSON.stringify([
    pathname,
    query,
    location.hash,
    browserEntryKeySignature(location.state),
  ]);
}

export type LocationSync = {
  acknowledge(location: SplitRouterExternalLocationValue): boolean;
  commit(
    entries: SplitRouterEntry[],
    options: {
      history: BrowserHistoryIntent;
      preserveHash: boolean;
      preserveExternalSearch?: boolean;
    }
  ): void;
};

export function createLocationSync(options: {
  routes: SplitRoutesManifest;
  location: SplitRouterExternalLocation;
}): LocationSync {
  const outbound: string[] = [];
  let desired = options.location.read();

  const commitExternal = (
    next: SplitRouterExternalLocationValue,
    history: BrowserHistoryIntent
  ) => {
    const signature = externalLocationSignature(next);

    if (
      (outbound.length === 0 &&
        signature === externalLocationSignature(options.location.read())) ||
      outbound.at(-1) === signature
    ) {
      return;
    }

    outbound.push(signature);
    options.location.commit(next, { history });
  };

  return {
    acknowledge(external) {
      const signature = externalLocationSignature(external);
      const index = outbound.lastIndexOf(signature);

      if (index < 0) {
        outbound.length = 0;
        return false;
      }

      // Location adapters may coalesce writes (last transition wins). Once a
      // newer write is observed, earlier signatures cannot remain echo tokens:
      // a later Back to one of those URLs is genuine external navigation.
      outbound.splice(0, index + 1);

      const desiredSignature = externalLocationSignature(desired);
      if (
        signature !== desiredSignature &&
        !outbound.includes(desiredSignature)
      ) {
        commitExternal(desired, 'replace');
      }

      return true;
    },

    commit(entries, commitOptions) {
      desired = encodeSplitRouterLocation({
        routes: options.routes,
        entries,
        previous: options.location.read(),
        preserveHash: commitOptions.preserveHash,
        preserveExternalSearch: commitOptions.preserveExternalSearch,
      });
      commitExternal(desired, commitOptions.history);
    },
  };
}
