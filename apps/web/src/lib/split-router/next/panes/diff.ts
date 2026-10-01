import { currentEntry, findEntry } from './history';
import type { PaneEntry, PaneId, PaneSnapshot } from './types';

/** A pane decoded from a URL, with its id when history state recorded one. */
export type IncomingPane<E extends PaneEntry = PaneEntry> = {
  paneId?: PaneId;
  entry: E;
};

type PaneDiff<E extends PaneEntry = PaneEntry> =
  | { kind: 'keep'; pane: PaneId }
  /** `index` is set when the entry is already in the pane's history. */
  | { kind: 'change'; pane: PaneId; from: E; to: E; index?: number }
  | { kind: 'create'; pane: PaneId; entry: E };

export type ChangedPane<E extends PaneEntry = PaneEntry> = Exclude<
  PaneDiff<E>,
  { kind: 'keep' }
>;

export type PanesDiff<E extends PaneEntry = PaneEntry> = {
  /** One per incoming pane, in order. */
  panes: readonly PaneDiff<E>[];
  removed: readonly PaneId[];
};

export type LivePanes<E extends PaneEntry = PaneEntry> = {
  panes: readonly PaneId[];
  read(pane: PaneId): PaneSnapshot<E> | undefined;
};

export type DiffOptions<E extends PaneEntry = PaneEntry> = {
  createPaneId(): PaneId;
  /** Whether two entries show the same thing; a pane already showing it is kept. */
  same(current: E, incoming: E): boolean;
  /** What to show when `incoming` is already in a pane's history as `stored`. */
  adopt?(stored: E, incoming: E): E;
};

/**
 * How incoming panes line up with the open ones. Panes match by id, then
 * by position; panes already showing their entry are kept so nothing remounts.
 */
export function diffPanes<E extends PaneEntry>(
  live: LivePanes<E>,
  incoming: readonly IncomingPane<E>[],
  options: DiffOptions<E>
): PanesDiff<E> {
  const used: PaneId[] = [];
  const isLive = (pane: PaneId) => live.panes.includes(pane);
  const isUsed = (pane: PaneId) => used.includes(pane);

  const showsSame = (pane: PaneId, entry: E) => {
    const snapshot = live.read(pane);
    if (!snapshot) return false;

    return options.same(currentEntry(snapshot), entry);
  };

  const matchPane = (
    { paneId, entry }: IncomingPane<E>,
    position: number
  ): PaneId | undefined => {
    const liveAndFree = paneId && isLive(paneId) && !isUsed(paneId);
    if (liveAndFree) return paneId;

    const positional = live.panes[position];
    const slotTaken = positional === undefined || isUsed(positional);
    if (slotTaken) return;
    if (!paneId) return positional;
    if (isLive(paneId)) return;

    // An id from history that no longer exists: reuse the pane in its slot
    // only when it already shows the same thing.
    return showsSame(positional, entry) ? positional : undefined;
  };

  const idForNewPane = (paneId: PaneId | undefined): PaneId => {
    const reusable = paneId && !isLive(paneId) && !isUsed(paneId);

    return reusable ? paneId : options.createPaneId();
  };

  const createPane = ({ paneId, entry }: IncomingPane<E>): PaneDiff<E> => {
    const id = idForNewPane(paneId);
    used.push(id);

    return { kind: 'create', pane: id, entry };
  };

  const updatePane = (
    pane: PaneId,
    snapshot: PaneSnapshot<E>,
    entry: E
  ): PaneDiff<E> => {
    used.push(pane);

    const current = currentEntry(snapshot);
    const stored = findEntry(snapshot, entry.id);
    const movesCursor = stored !== undefined && stored.index !== snapshot.index;
    const unchanged = !movesCursor && options.same(current, entry);
    if (unchanged) return { kind: 'keep', pane };

    if (!stored) return { kind: 'change', pane, from: current, to: entry };

    const adopted = options.adopt?.(stored.entry, entry) ?? entry;

    return {
      kind: 'change',
      pane,
      from: current,
      index: stored.index,
      to: adopted,
    };
  };

  const diffPane = (pane: IncomingPane<E>, position: number): PaneDiff<E> => {
    const matched = matchPane(pane, position);
    if (!matched) return createPane(pane);

    const snapshot = live.read(matched);
    if (!snapshot) return createPane(pane);

    return updatePane(matched, snapshot, pane.entry);
  };

  const panes = incoming.map(diffPane);

  return {
    panes,
    removed: live.panes.filter((pane) => !isUsed(pane)),
  };
}

/** The panes a diff creates or changes, in order. */
export function changedPanes<E extends PaneEntry>(
  diff: PanesDiff<E>
): ChangedPane<E>[] {
  return diff.panes.filter(
    (pane): pane is ChangedPane<E> => pane.kind !== 'keep'
  );
}
