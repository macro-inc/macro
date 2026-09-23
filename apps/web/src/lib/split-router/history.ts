export type SplitRouterHistory<TEntry> = {
  entries(): readonly TEntry[];
  index(): number;
  current(): TEntry;
  canGo(delta: number): boolean;
  peek(delta: number): TEntry | undefined;
  go(delta: number): boolean;
  push(entry: TEntry): boolean;
  replace(entry: TEntry): boolean;
  accept(entry: TEntry, intent: 'push' | 'replace'): boolean;
};

export function createSplitRouterHistory<TEntry>(
  initial: TEntry,
  equals: (left: TEntry, right: TEntry) => boolean
): SplitRouterHistory<TEntry> {
  let items = [initial];
  let currentIndex = 0;

  const targetIndex = (delta: number) => {
    if (!Number.isSafeInteger(delta) || delta === 0) return;

    const target = currentIndex + delta;
    return target >= 0 && target < items.length ? target : undefined;
  };

  return {
    entries: () => items,
    index: () => currentIndex,
    current: () => items[currentIndex]!,

    canGo(delta) {
      return targetIndex(delta) !== undefined;
    },

    peek(delta) {
      const target = targetIndex(delta);
      return target === undefined ? undefined : items[target];
    },

    go(delta) {
      const target = targetIndex(delta);
      if (target === undefined) return false;

      currentIndex = target;
      return true;
    },

    push(entry) {
      if (equals(items[currentIndex]!, entry)) return false;

      items = [...items.slice(0, currentIndex + 1), entry];
      currentIndex = items.length - 1;
      return true;
    },

    replace(entry) {
      if (equals(items[currentIndex]!, entry)) return false;

      items = items.with(currentIndex, entry);
      return true;
    },

    accept(entry, intent) {
      if (equals(items[currentIndex]!, entry)) return false;

      const existingIndex = items.findIndex((candidate) =>
        equals(candidate, entry)
      );
      if (existingIndex >= 0) {
        currentIndex = existingIndex;
        return true;
      }

      if (intent === 'replace') {
        items = items.with(currentIndex, entry);
      } else {
        items = [...items.slice(0, currentIndex + 1), entry];
        currentIndex = items.length - 1;
      }
      return true;
    },
  };
}

export function createSplitRouterHistories<TId, TEntry>(
  equals: (left: TEntry, right: TEntry) => boolean
) {
  const histories = new Map<TId, SplitRouterHistory<TEntry>>();
  let order: TId[] = [];

  return {
    get: (id: TId) => histories.get(id),

    reconcile(
      entries: readonly { id: TId; entry: TEntry }[],
      intent: 'push' | 'replace',
      mode: 'move' | 'write'
    ) {
      const liveIds = new Set(entries.map(({ id }) => id));
      const nextOrder = entries.map(({ id }) => id);

      entries.forEach(({ id, entry }, index) => {
        let history = histories.get(id);

        if (!history) {
          const previousId = order[index];
          if (previousId !== undefined && !liveIds.has(previousId)) {
            history = histories.get(previousId);
            histories.delete(previousId);
            if (history) histories.set(id, history);
          }
        }

        if (history) {
          if (mode === 'move') history.accept(entry, intent);
          else if (intent === 'replace') history.replace(entry);
          else history.push(entry);
        } else {
          histories.set(id, createSplitRouterHistory(entry, equals));
        }
      });

      for (const id of histories.keys()) {
        if (!liveIds.has(id)) histories.delete(id);
      }
      order = nextOrder;
    },
  };
}
