import type {
  BrowserHistoryIntent,
  SplitRouterEntry,
  SplitRouterLayout,
  SplitRouterLayoutSnapshot,
  SplitRoutesManifest,
} from '@app/lib/split-router';
import deepEqual from 'fast-deep-equal';
import { createEffect, createRoot, on } from 'solid-js';
import type { SplitContent, SplitId, SplitManager } from './layoutManager';
import {
  resolveContentLocation,
  splitContentFromLocation,
} from './split-router/legacy-route';

export type AppSplitRouterLayout = SplitRouterLayout<SplitId>;
type AppSplitRouterSnapshot = SplitRouterLayoutSnapshot<SplitId>;

function contentForLocation(
  location: SplitRouterEntry['location'],
  current?: SplitContent
): SplitContent {
  const routed = splitContentFromLocation(location);
  let source = routed;
  if (current?.type === routed.type && current.id === routed.id) {
    source = current;
  }
  const { entryMetadata: _entryMetadata, ...content } = source;

  return { ...content, entryMetadata: location };
}

const sameRouterEntries = (
  previous: AppSplitRouterSnapshot['entries'],
  current: AppSplitRouterSnapshot['entries']
) =>
  previous.length === current.length &&
  previous.every((entry, index) => {
    const next = current[index];

    if (!next) return false;
    if (!Object.is(entry.splitId, next.splitId)) return false;
    return deepEqual(entry.location, next.location);
  });

function changeHistory(
  manager: SplitManager,
  previous: SplitRouterEntry[],
  next: SplitRouterEntry[]
): BrowserHistoryIntent {
  const index = next.findIndex((entry, entryIndex) => {
    const before = previous[entryIndex];
    return !before || !deepEqual(before.location.route, entry.location.route);
  });

  if (index < 0) return 'push';

  const changed = manager.getVisibleSplits()[index];

  return changed?.lastNavigationCause === 'replace' ? 'replace' : 'push';
}

export function createAppSplitRouterLayout(
  manager: SplitManager,
  routes: SplitRoutesManifest
): AppSplitRouterLayout {
  const snapshot = (): AppSplitRouterSnapshot => ({
    entries: manager.getVisibleSplits().map((split) => ({
      splitId: split.id,
      location: resolveContentLocation(routes, split.content),
    })),
  });

  return {
    snapshot,

    updateCurrentLocation(splitId, update, replace) {
      const handle = manager.getSplit(splitId);

      if (!handle) return;

      const current = resolveContentLocation(routes, handle.content());
      const next = update({ splitId, location: current });
      const content = contentForLocation(next, handle.content());
      const existing = handle.content();
      if (existing.type !== content.type || existing.id !== content.id) {
        handle.replace({ next: content, mergeHistory: replace });
        return;
      }

      // Child routes keep the workspace mounted but can dispose its list.
      // Capture list focus/scroll before committing that accepted transition.
      if (!deepEqual(current.route, next.route)) {
        handle.captureEntryState();
      }
      handle.updateCurrentEntry((currentContent) =>
        contentForLocation(next, currentContent)
      );
    },

    open({ location, target, replace }) {
      let handle: ReturnType<SplitManager['getSplit']>;
      if (target && target !== 'new-split') {
        handle = manager.getSplit(target);
      }

      const result = manager.openWithSplit(contentForLocation(location), {
        handle,
        preferNewSplit: target === 'new-split',
        allowDuplicate: target === 'new-split',
        mergeHistory: replace,
        referredFrom: null,
      });
      if (!result.split) return { status: 'unavailable' };

      const appliedLocation = resolveContentLocation(
        routes,
        result.split.content()
      );
      if (!deepEqual(appliedLocation, location)) {
        if (!deepEqual(appliedLocation.route, location.route)) {
          result.split.captureEntryState();
        }
        result.split.updateCurrentEntry((content) =>
          contentForLocation(location, content)
        );
      }
      return { status: 'applied', splitId: result.split.id };
    },

    reconcile(locations) {
      for (const [index, split] of manager.getVisibleSplits().entries()) {
        if (
          !deepEqual(
            resolveContentLocation(routes, split.content).route,
            locations[index]?.route
          )
        ) {
          manager.getSplit(split.id)?.captureEntryState();
        }
      }
      const visible = manager.getVisibleSplits();
      manager.reconcile(
        locations.map((location, index) =>
          contentForLocation(location, visible[index]?.content)
        )
      );
    },

    activate(splitId) {
      manager.getSplit(splitId)?.activate();
    },

    subscribe(listener) {
      return createRoot((dispose) => {
        let previous = snapshot().entries;
        createEffect(
          on(
            () => manager.getVisibleSplits(),
            () => {
              const current = snapshot().entries;
              if (sameRouterEntries(previous, current)) return;

              listener({
                history: changeHistory(manager, previous, current),
              });
              previous = current;
            },
            { defer: true }
          )
        );

        return dispose;
      });
    },
  };
}
