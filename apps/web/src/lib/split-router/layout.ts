import deepEqual from 'fast-deep-equal';
import { assertRouteEntry, type SplitRoutesManifest } from './routes';
import type {
  SplitRouterEntry,
  SplitRouterLayout,
  SplitRouterLayoutEntry,
} from './types';

export function createLayoutAdapter<TSplitId>(
  layout: SplitRouterLayout<TSplitId>,
  routes: SplitRoutesManifest
) {
  const snapshot = () => {
    const value = layout.snapshot();
    for (const entry of value.entries) assertRouteEntry(routes, entry);
    return value;
  };
  const entries = (): SplitRouterEntry[] =>
    snapshot().entries.map((entry) => ({
      location: entry.location,
    }));

  const find = (
    splitId: TSplitId
  ): SplitRouterLayoutEntry<TSplitId> | undefined =>
    snapshot().entries.find((entry) => Object.is(entry.splitId, splitId));

  const entryEquals = (
    left: SplitRouterEntry | undefined,
    right: SplitRouterEntry | undefined
  ): boolean =>
    left === right ||
    (left !== undefined &&
      right !== undefined &&
      deepEqual(left.location, right.location));

  const layoutsEqual = (
    left: SplitRouterEntry[],
    right: SplitRouterEntry[]
  ): boolean =>
    left.length === right.length &&
    left.every((entry, index) => entryEquals(entry, right[index]));

  const changedIds = (
    before: SplitRouterEntry[],
    after: SplitRouterEntry[]
  ): Set<TSplitId> => {
    const visible = snapshot().entries;
    const changed = new Set<TSplitId>();

    after.forEach((entry, index) => {
      if (entryEquals(before[index], entry)) return;

      const splitId = visible[index]?.splitId;
      if (splitId !== undefined) changed.add(splitId);
    });

    return changed;
  };

  const reconcile = (
    current: SplitRouterEntry[],
    requested: SplitRouterEntry[]
  ): boolean => {
    for (const entry of requested) assertRouteEntry(routes, entry);
    if (layoutsEqual(current, requested)) return false;

    layout.reconcile(requested);
    return true;
  };

  const apply = (options: {
    entry: SplitRouterEntry;
    target: TSplitId | 'new-split';
    replace: boolean;
    requireExistingTarget?: boolean;
  }): boolean => {
    assertRouteEntry(routes, options.entry);
    const targetId =
      options.target === 'new-split' ? undefined : options.target;
    const current = targetId === undefined ? undefined : find(targetId);

    if (options.requireExistingTarget && !current) return false;

    if (targetId !== undefined && current) {
      if (deepEqual(current.location, options.entry.location)) return false;

      layout.updateCurrentEntry(targetId, () => options.entry);
      return true;
    }

    layout.open({
      location: options.entry.location,
      target: options.target,
      replace: options.replace,
    });
    return true;
  };

  return {
    activate: (splitId: TSplitId) => layout.activate(splitId),
    apply,
    changedIds,
    entries,
    entryEquals,
    find,
    layoutsEqual,
    reconcile,
    snapshot,
  };
}
