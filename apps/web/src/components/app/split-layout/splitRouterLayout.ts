import type {
  BrowserHistoryIntent,
  SplitLocation,
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

const withoutLocation = (content: SplitContent): SplitContent => {
  const result = { ...content };

  delete result.entryMetadata;

  return result;
};

const withLocation = (
  content: SplitContent,
  location: SplitLocation
): SplitContent => ({
  ...content,
  entryMetadata: location,
});

const sameContent = (left: SplitContent, right: SplitContent) =>
  left.type === right.type && left.id === right.id;

function contentForLocation(
  location: SplitLocation,
  current?: SplitContent
): SplitContent {
  const routed = splitContentFromLocation(location);
  const content = current && sameContent(current, routed) ? current : routed;
  return withLocation(withoutLocation(content), location);
}

const sameRouterEntries = (
  previous: AppSplitRouterSnapshot['entries'],
  current: AppSplitRouterSnapshot['entries']
) =>
  previous.length === current.length &&
  previous.every((entry, index) => {
    const next = current[index];

    return (
      next !== undefined &&
      Object.is(entry.splitId, next.splitId) &&
      deepEqual(entry.location, next.location)
    );
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
  const locationOf = (content: SplitContent) =>
    resolveContentLocation(routes, content);
  const snapshot = (): AppSplitRouterSnapshot => ({
    entries: manager.getVisibleSplits().map((split) => ({
      splitId: split.id,
      location: locationOf(split.content),
    })),
  });

  return {
    snapshot,

    updateCurrentEntry(splitId, update) {
      const handle = manager.getSplit(splitId);

      if (!handle) return;

      const current = locationOf(handle.content());
      const next = update({ splitId, location: current });
      // Child routes keep the workspace mounted but can dispose its list.
      // Capture list focus/scroll before committing that accepted transition.
      if (!deepEqual(current.route, next.location.route)) {
        handle.captureEntryState();
      }
      handle.updateCurrentEntry((content) =>
        contentForLocation(next.location, content)
      );
    },

    open({ location, target, replace }) {
      const handle =
        target && target !== 'new-split' ? manager.getSplit(target) : undefined;

      manager.openWithSplit(contentForLocation(location), {
        handle,
        preferNewSplit: target === 'new-split',
        allowDuplicate: target === 'new-split',
        mergeHistory: replace,
        referredFrom: null,
      });
    },

    reconcile(entries) {
      for (const [index, split] of manager.getVisibleSplits().entries()) {
        if (
          !deepEqual(
            locationOf(split.content).route,
            entries[index]?.location.route
          )
        ) {
          manager.getSplit(split.id)?.captureEntryState();
        }
      }
      const visible = manager.getVisibleSplits();
      manager.reconcile(
        entries.map((entry, index) =>
          contentForLocation(entry.location, visible[index]?.content)
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
