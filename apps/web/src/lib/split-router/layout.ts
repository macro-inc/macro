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
    snapshot().entries.map(({ splitId: _splitId, ...entry }) => entry);

  const find = (
    splitId: TSplitId
  ): SplitRouterLayoutEntry<TSplitId> | undefined =>
    snapshot().entries.find((entry) => Object.is(entry.splitId, splitId));

  const entryEquals = (
    left: SplitRouterEntry | undefined,
    right: SplitRouterEntry | undefined
  ): boolean => {
    if (left === right) return true;
    if (!left || !right) return false;
    if (left.key !== right.key) return false;
    if (!deepEqual(left.location, right.location)) return false;
    return Object.is(left.state, right.state);
  };

  const entryIdentityEquals = (
    left: SplitRouterEntry,
    right: SplitRouterEntry
  ): boolean => {
    if (left.key !== undefined && right.key !== undefined) {
      return left.key === right.key;
    }
    return deepEqual(left.location, right.location);
  };

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
    let targetId: TSplitId | undefined;
    let current: SplitRouterLayoutEntry<TSplitId> | undefined;
    if (options.target !== 'new-split') {
      targetId = options.target;
      current = find(targetId);
    }

    if (options.requireExistingTarget && !current) return false;

    if (targetId !== undefined && current) {
      if (entryEquals(current, options.entry)) return false;

      layout.updateCurrentEntry(targetId, () => options.entry);
      return true;
    }

    layout.open({
      ...options.entry,
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
    entryIdentityEquals,
    find,
    layoutsEqual,
    reconcile,
    snapshot,
  };
}
