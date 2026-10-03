import { match } from 'ts-pattern';
import type {
  HistoryTarget,
  PaneChange,
  PaneEntry,
  PaneSnapshot,
} from './types';

export function currentEntry<E extends PaneEntry>(
  snapshot: PaneSnapshot<E>
): E {
  return snapshot.entries[snapshot.index]!;
}

/** The entry as it stays in history after leaving it: one-shot props are dropped. */
function leaveEntry<E extends PaneEntry>(entry: E): E {
  const unchanged = entry.keepProps || entry.props === undefined;
  if (unchanged) return entry;

  const { props: _props, ...rest } = entry;

  return rest as E;
}

export function applyHistoryChange<E extends PaneEntry>(
  snapshot: PaneSnapshot<E>,
  change: PaneChange<E>
): PaneSnapshot<E> {
  const { entries, index } = snapshot;
  const afterLeave = () => entries.with(index, leaveEntry(entries[index]!));

  return match<PaneChange<E>, PaneSnapshot<E>>(change)
    .with({ type: 'push' }, ({ entry }) => ({
      entries: [...afterLeave().slice(0, index + 1), entry],
      index: index + 1,
    }))
    .with({ type: 'replace' }, ({ entry }) => ({
      entries: entries.with(index, entry),
      index,
    }))
    .with({ type: 'go' }, (go) => {
      const outOfRange = go.index < 0 || go.index >= entries.length;
      if (outOfRange) {
        throw new Error(`Pane history has no entry at ${go.index}`);
      }

      const staying = go.index === index;
      const base = staying ? entries : afterLeave();

      return { entries: base.with(go.index, go.entry), index: go.index };
    })
    .with({ type: 'reset' }, (reset) => ({
      entries: [...reset.entries],
      index: reset.index,
    }))
    .exhaustive();
}

function hasIndex(entries: readonly unknown[], index: number): boolean {
  return index >= 0 && index < entries.length;
}

/** Moves `delta` steps, counting only entries `visit` accepts. */
export function findStep<E extends PaneEntry>(
  snapshot: PaneSnapshot<E>,
  delta: number,
  visit: (entry: E) => boolean = () => true
): HistoryTarget<E> | undefined {
  const moves = Number.isSafeInteger(delta) && delta !== 0;
  if (!moves) return;

  const direction = delta < 0 ? -1 : 1;
  let remaining = Math.abs(delta);

  for (
    let index = snapshot.index + direction;
    hasIndex(snapshot.entries, index);
    index += direction
  ) {
    const entry = snapshot.entries[index]!;
    if (!visit(entry)) continue;

    remaining -= 1;
    if (remaining === 0) return { entry, index };
  }
}

/** The nearest earlier entry matching `predicate` that `visit` accepts. */
export function findBack<E extends PaneEntry>(
  snapshot: PaneSnapshot<E>,
  predicate: (entry: E) => boolean,
  visit: (entry: E) => boolean = () => true
): HistoryTarget<E> | undefined {
  for (let index = snapshot.index - 1; index >= 0; index -= 1) {
    const entry = snapshot.entries[index]!;
    const found = visit(entry) && predicate(entry);
    if (found) return { entry, index };
  }
}

export function findEntry<E extends PaneEntry>(
  snapshot: PaneSnapshot<E>,
  entryId: string
): HistoryTarget<E> | undefined {
  const index = snapshot.entries.findIndex((entry) => entry.id === entryId);
  if (index < 0) return;

  return { entry: snapshot.entries[index]!, index };
}

/** Removes matching entries, keeping the cursor on the nearest survivor. */
export function removeEntries<E extends PaneEntry>(
  snapshot: PaneSnapshot<E>,
  predicate: (entry: E) => boolean
): PaneSnapshot<E> | undefined {
  let index = snapshot.index;
  const entries: E[] = [];

  snapshot.entries.forEach((entry, position) => {
    if (!predicate(entry)) {
      entries.push(entry);
      return;
    }

    const beforeCursor = position < snapshot.index;
    if (beforeCursor) index -= 1;
  });

  if (entries.length === 0) return;

  const lastIndex = entries.length - 1;
  const cursor = Math.min(Math.max(index, 0), lastIndex);

  return { entries, index: cursor };
}
