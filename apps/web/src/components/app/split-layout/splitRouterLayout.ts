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
  resolveContentEntry,
  splitContentFromLocation,
} from './split-router/legacy-route';

export type AppSplitRouterLayout = SplitRouterLayout<SplitId>;
type AppSplitRouterSnapshot = SplitRouterLayoutSnapshot<SplitId>;

function contentForEntry(
  entry: SplitRouterEntry,
  current?: SplitContent
): SplitContent {
  const routed = splitContentFromLocation(entry.location);
  let source = routed;
  if (current?.type === routed.type && current.id === routed.id) {
    source = current;
  }
  const { entryMetadata: _entryMetadata, ...content } = source;

  return { ...content, entryMetadata: entry };
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
    if (entry.key !== next.key) return false;
    if (!deepEqual(entry.location, next.location)) return false;
    return Object.is(entry.state, next.state);
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
      ...resolveContentEntry(routes, split.content),
    })),
  });

  return {
    snapshot,

    updateCurrentEntry(splitId, update) {
      const handle = manager.getSplit(splitId);

      if (!handle) return;

      const current = resolveContentEntry(routes, handle.content());
      const next = update({ splitId, ...current });
      // Child routes keep the workspace mounted but can dispose its list.
      // Capture list focus/scroll before committing that accepted transition.
      if (!deepEqual(current.location.route, next.location.route)) {
        handle.captureEntryState();
      }
      handle.updateCurrentEntry((content) => contentForEntry(next, content));
    },

    open({ target, replace, ...entry }) {
      let handle: ReturnType<SplitManager['getSplit']>;
      if (target && target !== 'new-split') {
        handle = manager.getSplit(target);
      }

      manager.openWithSplit(contentForEntry(entry), {
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
            resolveContentEntry(routes, split.content).location.route,
            entries[index]?.location.route
          )
        ) {
          manager.getSplit(split.id)?.captureEntryState();
        }
      }
      const visible = manager.getVisibleSplits();
      manager.reconcile(
        entries.map((entry, index) =>
          contentForEntry(entry, visible[index]?.content)
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
