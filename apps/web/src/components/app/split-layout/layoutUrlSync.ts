import type { Navigator } from '@solidjs/router';
import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  on,
  onCleanup,
} from 'solid-js';
import type { SplitContent, SplitManager } from './layoutManager';
import { decodePairs } from './layoutUtils';
import {
  PREVIEW_QUERY_PARAM,
  type PreviewPairUrlEntry,
  type PreviewQueryValue,
  type RestorablePreviewLayout,
  serializePreviewPairs,
} from './previewPersistence';

type LayoutUrlSyncEnvironment = {
  navigate: Navigator;
  search: Accessor<string>;
  hash: Accessor<string>;
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

/** Restore URL-declared Preview Pairs through the manager's invariant gate. */
export function restorePreviewPairs(
  splitManager: SplitManager,
  previewPairs: readonly PreviewPairUrlEntry[]
) {
  const splits = splitManager.splits();
  for (const previewPair of previewPairs) {
    const controller = splits[previewPair.controllerIndex];
    const viewer = splits[previewPair.controllerIndex + 1];
    if (!controller || !viewer) continue;
    splitManager.restorePreviewPair(controller.id, viewer.id);
  }
}

function previewPairsForUrl(splitManager: SplitManager): PreviewPairUrlEntry[] {
  const splits = splitManager.getVisibleSplits();
  const indices = new Map(splits.map((split, index) => [split.id, index]));
  return splitManager
    .previewPairs()
    .flatMap((previewPair): PreviewPairUrlEntry[] => {
      const controllerIndex = indices.get(previewPair.controllerId);
      return controllerIndex === undefined ? [] : [{ controllerIndex }];
    });
}

function previewQueryMatches(
  current: PreviewQueryValue,
  canonical: string | undefined
): boolean {
  return current === canonical;
}

/**
 * Keep the split manager and the path/query representation of its layout in
 * sync. Router access is injected so the reactive behavior can be tested
 * without mounting the complete split UI.
 */
export function createLayoutUrlSync(
  splitManager: SplitManager,
  pairs: Accessor<string[]>,
  previewQuery: Accessor<PreviewQueryValue>,
  decodedLayout: Accessor<RestorablePreviewLayout>,
  environment: LayoutUrlSyncEnvironment
) {
  let reconcilingFromUrl = false;
  let managerSyncQueued = false;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  const managerUrlState = () => {
    const segments = splitManager.getUrlSegments();
    const preview = serializePreviewPairs(previewPairsForUrl(splitManager));
    return { segments, preview };
  };

  const managerUrlSignature = () => {
    const state = managerUrlState();
    return JSON.stringify([state.segments, state.preview]);
  };

  const urlLayoutDrift = createMemo(() => {
    const state = managerUrlState();
    return (
      state.segments.join('/') !== pairs().join('/') ||
      !previewQueryMatches(previewQuery(), state.preview)
    );
  });

  const syncManagerToUrl = (options: { replace?: boolean } = {}) => {
    if (!urlLayoutDrift()) return;

    const nextState = managerUrlState();
    const pathChanged = nextState.segments.join('/') !== pairs().join('/');
    const currentQuery = new URLSearchParams(environment.search());
    // On a direct macrod pairing link, the settings split initially serializes
    // its default tab before the settings wrapper reads `settings/harness`.
    // Let that wrapper select Harness instead of replacing the requested URL.
    if (
      pathChanged &&
      pairs()[0] === 'settings' &&
      pairs()[1] === 'harness' &&
      currentQuery.get('pair')
    ) {
      return;
    }
    const nextPairs = decodePairs(nextState.segments);
    const affectedSplit = getUrlSyncAffectedSplit(
      splitManager,
      decodedLayout().contents,
      nextPairs
    );
    const replace =
      options.replace ?? affectedSplit?.lastNavigationCause === 'replace';

    // Preserve unrelated query/hash state for query-only updates. Path
    // changes retain the existing split-navigation behavior of clearing
    // content-specific location state.
    const query = pathChanged ? new URLSearchParams() : currentQuery;
    if (nextState.preview) {
      query.set(PREVIEW_QUERY_PARAM, nextState.preview);
    } else {
      query.delete(PREVIEW_QUERY_PARAM);
    }
    const search = query.toString();
    const hash = pathChanged ? '' : environment.hash();
    const nextUrl = `/${nextState.segments.join('/')}${
      search ? `?${search}` : ''
    }${hash}`;

    environment.navigate(nextUrl, { replace });
  };

  // Preview operations can update splits and their Preview Pair in separate
  // reactive writes. Coalesce those writes so the URL never observes an
  // intermediate bare placeholder or severed Preview Pair.
  const scheduleManagerToUrlSync = () => {
    if (managerSyncQueued) return;
    managerSyncQueued = true;
    queueMicrotask(() => {
      managerSyncQueued = false;
      if (!disposed && !reconcilingFromUrl) syncManagerToUrl();
    });
  };

  /** Sync changes from the layout manager to path and query together. */
  createEffect(
    on(
      managerUrlSignature,
      () => {
        if (!reconcilingFromUrl) scheduleManagerToUrlSync();
      },
      { defer: true }
    )
  );

  /** Sync changes from either URL path or preview query to the manager. */
  createEffect(
    on([pairs, previewQuery], () => {
      if (urlLayoutDrift()) {
        const nextLayout = decodedLayout();
        reconcilingFromUrl = true;
        try {
          batch(() => {
            for (const previewPair of splitManager.previewPairs()) {
              splitManager.unlinkPreviewPair(previewPair.controllerId);
            }
            splitManager.reconcile(nextLayout.contents);
            restorePreviewPairs(splitManager, nextLayout.previewPairs);
          });
        } finally {
          reconcilingFromUrl = false;
        }

        // Invalid query tuples and unlinked placeholders are rewritten to the
        // manager's canonical representation without adding browser history.
        if (urlLayoutDrift()) syncManagerToUrl({ replace: true });
      }
    })
  );
}
