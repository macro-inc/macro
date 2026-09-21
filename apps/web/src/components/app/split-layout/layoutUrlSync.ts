import type { Navigator } from '@solidjs/router';
import {
  type Accessor,
  createEffect,
  createMemo,
  on,
  onCleanup,
} from 'solid-js';
import type { SplitContent, SplitManager } from './layoutManager';
import { decodePairs } from './layoutUtils';

type LayoutUrlSyncEnvironment = {
  navigate: Navigator;
  search: Accessor<string>;
};

function sameSplitContentIdentity(a: SplitContent, b: SplitContent) {
  return a.type === b.type && a.id === b.id;
}

function getUrlSyncAffectedSplit(
  splitManager: SplitManager,
  currentPairs: SplitContent[],
  nextPairs: SplitContent[]
) {
  const changedIndex = nextPairs.findIndex(
    (nextPair, index) =>
      !currentPairs[index] ||
      !sameSplitContentIdentity(currentPairs[index], nextPair)
  );

  if (changedIndex < 0) return undefined;

  const affectedPair = nextPairs[changedIndex];
  return splitManager
    .splits()
    .find((split) => sameSplitContentIdentity(split.content, affectedPair));
}

/**
 * Keep the split manager and the path representation of its layout in
 * sync. Router access is injected so the reactive behavior can be tested
 * without mounting the complete split UI.
 */
export function createLayoutUrlSync(
  splitManager: SplitManager,
  pairs: Accessor<string[]>,
  environment: LayoutUrlSyncEnvironment
) {
  let reconcilingFromUrl = false;
  let managerSyncQueued = false;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  const managerUrlSignature = () => splitManager.getUrlSegments().join('/');
  const urlLayoutDrift = createMemo(
    () => managerUrlSignature() !== pairs().join('/')
  );

  const syncManagerToUrl = (options: { replace?: boolean } = {}) => {
    if (!urlLayoutDrift()) return;

    const segments = splitManager.getUrlSegments();
    const currentQuery = new URLSearchParams(environment.search());
    // Action links can mount before settings has selected its requested tab.
    // Preserve their query until the wrapper has canonicalized that tab.
    if (
      pairs()[0] === 'settings' &&
      ((pairs()[1] === 'harness' && currentQuery.get('pair')) ||
        (pairs()[1] === 'agents' && currentQuery.get('createAgent') === 'true'))
    ) {
      return;
    }
    const nextPairs = decodePairs(segments);
    const affectedSplit = getUrlSyncAffectedSplit(
      splitManager,
      decodePairs(pairs()),
      nextPairs
    );
    const replace =
      options.replace ?? affectedSplit?.lastNavigationCause === 'replace';

    // Path changes clear content-specific query and hash locations.
    const nextUrl = `/${segments.join('/')}`;

    environment.navigate(nextUrl, { replace });
  };

  // Coalesce batched layout mutations into one URL update.
  const scheduleManagerToUrlSync = () => {
    if (managerSyncQueued) return;
    managerSyncQueued = true;
    queueMicrotask(() => {
      managerSyncQueued = false;
      if (!disposed && !reconcilingFromUrl) syncManagerToUrl();
    });
  };

  /** Sync changes from the layout manager to the URL path. */
  createEffect(
    on(
      managerUrlSignature,
      () => {
        if (!reconcilingFromUrl) scheduleManagerToUrlSync();
      },
      { defer: true }
    )
  );

  /** Sync changes from the URL path to the manager. */
  createEffect(
    on(pairs, () => {
      if (urlLayoutDrift()) {
        const nextContents = decodePairs(pairs());
        reconcilingFromUrl = true;
        try {
          splitManager.reconcile(nextContents);
        } finally {
          reconcilingFromUrl = false;
        }

        // Rewrite invalid URL content without adding browser history.
        if (urlLayoutDrift()) syncManagerToUrl({ replace: true });
      }
    })
  );
}
