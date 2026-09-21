import type { SplitRoutesManifest } from './routes';
import type {
  BrowserHistoryIntent,
  SplitRouterEntry,
  SplitRouterExternalLocation,
  SplitRouterExternalLocationValue,
} from './types';
import { encodeSplitRouterLocation } from './url';

function externalLocationSignature(
  location: SplitRouterExternalLocationValue
): string {
  const query = [...new URLSearchParams(location.search)].sort(
    ([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey
        ? leftValue.localeCompare(rightValue)
        : leftKey.localeCompare(rightKey)
  );
  const pathname =
    location.pathname.length > 1
      ? location.pathname.replace(/\/+$/g, '')
      : location.pathname || '/';

  return JSON.stringify([pathname, query, location.hash]);
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
      signature === externalLocationSignature(options.location.read()) ||
      outbound.includes(signature)
    ) {
      return;
    }

    outbound.push(signature);
    options.location.commit(next, { history });
  };

  return {
    acknowledge(external) {
      const signature = externalLocationSignature(external);
      const index = outbound.indexOf(signature);

      if (index < 0) return false;

      outbound.splice(index, 1);

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
