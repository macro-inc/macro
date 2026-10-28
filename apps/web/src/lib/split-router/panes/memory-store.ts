import { type Accessor, createSignal, type Setter, untrack } from 'solid-js';
import { applyHistoryChange } from './history';
import type { PaneEntry, PaneId, PaneSnapshot, PaneStore } from './types';

type Stored<E extends PaneEntry> = {
  pane: PaneId;
  read: Accessor<PaneSnapshot<E>>;
  write: Setter<PaneSnapshot<E>>;
};

export function createMemoryPaneStore<
  E extends PaneEntry = PaneEntry,
>(): PaneStore<E> {
  // The id list in `createPanes` is what makes new panes visible to readers.
  const stored: Stored<E>[] = [];
  const find = (pane: PaneId) => stored.find((item) => item.pane === pane);

  return {
    create(pane, entry) {
      const snapshot: PaneSnapshot<E> = { entries: [entry], index: 0 };
      const existing = find(pane);

      if (existing) {
        existing.write(() => snapshot);
        return;
      }

      const [read, write] = createSignal(snapshot);
      stored.push({ pane, read, write });
    },

    remove(pane) {
      const index = stored.findIndex((item) => item.pane === pane);
      if (index >= 0) stored.splice(index, 1);
    },

    read: (pane) => find(pane)?.read(),

    apply(pane, change) {
      const item = find(pane);
      if (!item) throw new Error(`Pane "${pane}" has no history`);

      const next = applyHistoryChange(untrack(item.read), change);
      item.write(() => next);
    },
  };
}
