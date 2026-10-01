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
  type PanesDiff,
  type LivePanes,
} from './diff';
import { currentEntry } from './history';
import type {
  CloseAction,
  PaneArrival,
  PaneChange,
  PaneEntry,
  PaneId,
  PanePolicy,
  PaneStore,
  OpenIntent,
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
  const [arrivals, setArrivals] = createStore<
    Record<string, PaneArrival | undefined>
  >({});
  const createPaneId = options.createPaneId ?? newPaneId;

  const current = (pane: PaneId): E | undefined => {
    const snapshot = store.read(pane);
    if (!snapshot) return;

    return currentEntry(snapshot);
  };

  const arrange = (next: readonly PaneId[], changes: () => void) => {
    batch(() => {
      changes();
      setIds(next);
    });
  };

  const addPane = (pane: PaneId, entry: E) => {
    store.create(pane, entry);
    setArrivals(pane, 'fresh');
  };

  const forget = (pane: PaneId) => {
    store.remove(pane);
    setArrivals(pane, undefined);
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

    /** Adds a pane at `insertAt` as chosen against `decided`, the panes at the time. */
    insert(
      pane: PaneId,
      entry: E,
      insertAt: number,
      decided: readonly PaneId[] = untrack(ids)
    ) {
      const next = [...untrack(ids)];
      const at = insertionIndex(decided, insertAt, next);
      next.splice(at, 0, pane);
      arrange(next, () => addPane(pane, entry));
    },

    remove(pane: PaneId) {
      const next = untrack(ids).filter((id) => id !== pane);
      arrange(next, () => forget(pane));
    },

    /** False when `pane` isn't open or already sits at `to`. */
    move(pane: PaneId, to: number): boolean {
      const before = untrack(ids);
      if (!before.includes(pane)) return false;

      const next = before.filter((id) => id !== pane);
      const at = Math.max(0, Math.min(to, next.length));
      next.splice(at, 0, pane);
      if (sameIds(before, next)) return false;

      setIds(next);

      return true;
    },

    /** How `incoming` lines up with the open panes. */
    diff(
      incoming: readonly IncomingPane<E>[],
      diffOptions: Omit<DiffOptions<E>, 'createPaneId'>
    ): PanesDiff<E> {
      const live: LivePanes<E> = {
        panes: untrack(ids),
        read: (pane) => untrack(() => store.read(pane)),
      };

      return diffPanes(live, incoming, { ...diffOptions, createPaneId });
    },

    /** Applies `diff`; `entries` are what its changed panes show, in order. */
    applyDiff(diff: PanesDiff<E>, entries: readonly E[]) {
      const next = diff.panes.map((item) => item.pane);

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
