import { batch, createSignal, untrack } from 'solid-js';
import { createStore } from 'solid-js/store';
import { match } from 'ts-pattern';
import { createId } from '../utils';
import {
  type ChangedPane,
  changedPanes,
  type DiffOptions,
  diffPanes,
  type IncomingPane,
  type LivePanes,
  type PanesDiff,
} from './diff';
import { currentEntry } from './history';
import {
  fillShape,
  insertColumn,
  type LayoutShape,
  type PaneLayout,
  paneIds,
  removePane,
  reorderPanes,
  resetShares,
  resizeSplit,
  rowLayout,
  type SplitPath,
  type SplitSide,
  splitPane,
  tilesFor,
  withoutPanes,
  withSharesFrom,
} from './layout-tree';
import type {
  CloseAction,
  OpenIntent,
  PaneArrival,
  PaneChange,
  PaneEntry,
  PaneId,
  PanePolicy,
  PaneStore,
  Placement,
} from './types';

function sameIds(left: readonly PaneId[], right: readonly PaneId[]): boolean {
  const sameLength = left.length === right.length;

  return sameLength && left.every((id, index) => id === right[index]);
}

function isOpenedSince(
  decided: readonly PaneId[],
  pane: PaneId | undefined
): boolean {
  return pane !== undefined && !decided.includes(pane);
}

function skipOpenedSince(
  decided: readonly PaneId[],
  current: readonly PaneId[],
  start: number
): number {
  let index = start;
  while (isOpenedSince(decided, current[index])) index += 1;

  return index;
}

/**
 * Where a pane placed at `insertAt` among `decided` goes in `current`: after
 * the same pane as before, behind panes opened since, so concurrent opens keep
 * their order.
 */
export function insertionIndex(
  decided: readonly PaneId[],
  insertAt: number,
  current: readonly PaneId[]
): number {
  const at = Math.max(0, Math.min(insertAt, decided.length));
  const after = at > 0 ? decided[at - 1] : undefined;
  if (after === undefined) return skipOpenedSince(decided, current, 0);

  const afterIndex = current.indexOf(after);
  if (afterIndex < 0) return Math.min(at, current.length);

  return skipOpenedSince(decided, current, afterIndex + 1);
}

const newPaneId = () => createId('pane') as PaneId;

function historyChangeFor<E extends PaneEntry>(
  entry: E,
  index: number | undefined
): PaneChange<E> {
  if (index === undefined) return { type: 'push', entry };

  return { type: 'go', index, entry };
}

/**
 * How panes landing together tile, in order: a URL's `shape`, keeping the
 * current sizes where it matches, or a captured `layout` with its own sizes.
 */
export type Arrangement = { shape?: LayoutShape } | { layout: PaneLayout };

/** Where `insert` puts a new pane. */
export type NewPanePlacement = {
  insertAt: number;
  split?: { pane: PaneId; side: SplitSide };
};

export type PanesOptions<E extends PaneEntry, D> = {
  store: PaneStore<E>;
  policy: PanePolicy<E, D>;
  createPaneId?: () => PaneId;
  /** Runs for each pane that is removed. */
  onRemove?: (pane: PaneId) => void;
};

/**
 * The open panes, in order, with each one's history and how it arrived. It
 * knows nothing about routes or rendering: callers decide what a pane shows
 * and commit the result here, and the policy decides placement and closing.
 */
export function createPanes<E extends PaneEntry, D>(
  options: PanesOptions<E, D>
) {
  const { store, policy } = options;
  const [ids, setIds] = createSignal<readonly PaneId[]>([], {
    equals: sameIds,
  });
  // The open panes are this layout's panes, in order; set both together.
  const [layout, setLayout] = createSignal<PaneLayout | undefined>();
  // Every pane with a history: the open ones plus any a host parked (took
  // out of `ids` without removing) to show again later.
  const [retained, setRetained] = createSignal<readonly PaneId[]>([], {
    equals: sameIds,
  });
  // How parked panes tile, one layout per group parked together, so a group
  // shows again as it was.
  const [parkedLayouts, setParkedLayouts] = createSignal<readonly PaneLayout[]>(
    []
  );
  const [arrivals, setArrivals] = createStore<
    Record<string, PaneArrival | undefined>
  >({});
  const createPaneId = options.createPaneId ?? newPaneId;

  const current = (pane: PaneId): E | undefined => {
    const snapshot = store.read(pane);
    if (!snapshot) return;

    return currentEntry(snapshot);
  };

  /**
   * Makes `next` the open layout once `changes` ran. Open panes it leaves out
   * that still have a history are parked, keeping their tiles.
   */
  const arrange = (next: PaneLayout | undefined, changes: () => void) => {
    batch(() => {
      const before = untrack(layout);
      changes();

      const open = paneIds(next);
      const kept = untrack(retained);
      const parks = (pane: PaneId) =>
        !open.includes(pane) && kept.includes(pane);
      const parked = withoutPanes(before, (pane) => !parks(pane));
      setParkedLayouts((list) => {
        const rest = list.flatMap(
          (tiles) => withoutPanes(tiles, (pane) => open.includes(pane)) ?? []
        );

        return parked ? [...rest, parked] : rest;
      });
      setLayout(next);
      setIds(open);
    });
  };

  /** The layout holding `pane`: the open one, or the one it was parked in. */
  const layoutOf = (pane: PaneId): PaneLayout | undefined =>
    [layout(), ...parkedLayouts()].find((tiles) =>
      paneIds(tiles).includes(pane)
    );

  /** How the panes landing in a diff tile; in a row when the arrangement doesn't fit them. */
  const landedLayout = (
    landed: readonly PaneId[],
    arrangement: Arrangement
  ): PaneLayout | undefined => {
    if ('layout' in arrangement) {
      const fits = paneIds(arrangement.layout).length === landed.length;

      return fits
        ? reorderPanes(arrangement.layout, landed)
        : rowLayout(landed);
    }

    const { shape } = arrangement;
    const shaped = shape ? fillShape(shape, landed) : undefined;

    return withSharesFrom(shaped ?? rowLayout(landed), untrack(layout));
  };

  const addPane = (pane: PaneId, entry: E) => {
    store.create(pane, entry);
    setArrivals(pane, 'fresh');
    setRetained((list) => (list.includes(pane) ? list : [...list, pane]));
  };

  const forget = (pane: PaneId) => {
    store.remove(pane);
    setArrivals(pane, undefined);
    setRetained((list) => list.filter((id) => id !== pane));
    setParkedLayouts((list) =>
      list.flatMap((tiles) => removePane(tiles, pane) ?? [])
    );
    options.onRemove?.(pane);
  };

  const arrivalFor = (
    change: ChangedPane<E> & { kind: 'change' }
  ): PaneArrival => {
    if (change.index === undefined) return 'fresh';

    const { index } = untrack(() => store.read(change.pane))!;
    if (change.index === index) return 'replace';

    return change.index < index ? 'back' : 'forward';
  };

  const applyChange = (change: ChangedPane<E>, entry: E) => {
    match<ChangedPane<E>, void>(change)
      .with({ kind: 'create' }, ({ pane }) => addPane(pane, entry))
      .with({ kind: 'change' }, (changed) => {
        setArrivals(changed.pane, arrivalFor(changed));
        store.apply(changed.pane, historyChangeFor(entry, changed.index));
      })
      .exhaustive();
  };

  return {
    ids,
    layout,
    layoutOf,
    retained,
    read: (pane: PaneId) => store.read(pane),
    current,
    arrival: (pane: PaneId): PaneArrival => arrivals[pane] ?? 'fresh',
    createPaneId,

    /** Records a change to one pane's history. */
    commit(pane: PaneId, change: PaneChange<E>, arrival?: PaneArrival) {
      batch(() => {
        store.apply(pane, change);
        if (arrival) setArrivals(pane, arrival);
      });
    },

    /**
     * Adds a pane where `placement` says: splitting a pane that is still
     * open, or else as a column at `insertAt` as chosen against `decided`,
     * the panes at the time.
     */
    insert(
      pane: PaneId,
      entry: E,
      placement: NewPanePlacement,
      decided: readonly PaneId[] = untrack(ids)
    ) {
      const current = untrack(layout);
      const open = untrack(ids);
      const { split } = placement;

      if (current && split && open.includes(split.pane)) {
        const next = splitPane(current, split.pane, pane, split.side);
        arrange(next, () => addPane(pane, entry));
        return;
      }

      const at = insertionIndex(decided, placement.insertAt, open);
      const next = insertColumn(current, pane, open[at - 1]);
      arrange(next, () => addPane(pane, entry));
    },

    remove(pane: PaneId) {
      const next = removePane(untrack(layout), pane);
      arrange(next, () => forget(pane));
    },

    /**
     * Makes `next`, retained panes, the open ones, in the tiles they last
     * had together (side by side when they never tiled together). Open panes
     * not in `next` stay retained (parked) with their histories and tiles
     * until `discard`.
     */
    show(next: readonly PaneId[]) {
      const known = untrack(retained);
      const missing = next.some((pane) => !known.includes(pane));
      if (missing) throw new Error('Only retained panes can be shown');

      const together = untrack(() => tilesFor(layoutOf(next[0]!), next));
      arrange(together ?? rowLayout(next), () => {});
    },

    /** Forgets a parked pane; open panes are removed through `remove`. */
    discard(pane: PaneId) {
      if (untrack(ids).includes(pane)) return;
      if (!untrack(retained).includes(pane)) return;

      forget(pane);
    },

    /**
     * Moves `pane` to `to` in the order; the tiles keep their sizes and show
     * the panes in their new order. False when `pane` isn't open or already
     * sits at `to`.
     */
    move(pane: PaneId, to: number): boolean {
      const before = untrack(ids);
      if (!before.includes(pane)) return false;

      const next = before.filter((id) => id !== pane);
      const at = Math.max(0, Math.min(to, next.length));
      next.splice(at, 0, pane);
      if (sameIds(before, next)) return false;

      arrange(reorderPanes(untrack(layout), next), () => {});

      return true;
    },

    /** Divides the split at `path` by `shares`; the URL doesn't record sizes. */
    resize(path: SplitPath, shares: readonly number[]) {
      setLayout(resizeSplit(untrack(layout), path, shares));
    },

    /** Divides every split equally. */
    resetShares() {
      setLayout(resetShares(untrack(layout)));
    },

    /** How `incoming` lines up with the open panes. */
    diff(
      incoming: readonly IncomingPane<E>[],
      diffOptions: Omit<DiffOptions<E>, 'createPaneId'>
    ): PanesDiff<E> {
      const open = untrack(ids);
      const live: LivePanes<E> = {
        panes: open,
        parked: untrack(retained).filter((pane) => !open.includes(pane)),
        read: (pane) => untrack(() => store.read(pane)),
      };

      return diffPanes(live, incoming, { ...diffOptions, createPaneId });
    },

    /**
     * Applies `diff`; `entries` are what its changed panes show, in order,
     * and `arrangement` is how its panes tile.
     */
    applyDiff(
      diff: PanesDiff<E>,
      entries: readonly E[],
      arrangement: Arrangement = {}
    ) {
      const landed = diff.panes.map((item) => item.pane);
      const next = landedLayout(landed, arrangement);

      arrange(next, () => {
        for (const pane of diff.removed) forget(pane);

        changedPanes(diff).forEach((change, position) => {
          applyChange(change, entries[position]!);
        });
      });
    },

    placeNewPane(request: {
      destination: D;
      source?: PaneId;
      intent?: OpenIntent;
      holder?: PaneId;
      allowDuplicate?: boolean;
      opening?: number;
    }): Placement {
      return policy.placeNewPane({
        ...request,
        intent: request.intent ?? {},
        allowDuplicate: request.allowDuplicate ?? false,
        opening: request.opening ?? 0,
        panes: untrack(ids),
      });
    },

    closeAction(pane: PaneId): CloseAction<E, D> {
      return policy.closeAction({ pane, panes: untrack(ids) });
    },

    activate: (pane: PaneId) => policy.activate(pane),
  };
}

export type Panes<E extends PaneEntry = PaneEntry, D = unknown> = ReturnType<
  typeof createPanes<E, D>
>;
