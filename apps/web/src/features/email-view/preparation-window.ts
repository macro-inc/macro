import type { EmailPreparation } from '../email-message/context/email-preparation';

type PrepareThread = (
  preparation: EmailPreparation,
  threadId: string,
  priority: number
) => () => void;

function selectNeighbors(ids: readonly string[], focusedId?: string): string[] {
  const index = focusedId ? ids.indexOf(focusedId) : -1;
  return index < 0
    ? []
    : [index, index + 1, index - 1, index + 2, index - 2]
        .filter((position) => position >= 0 && position < ids.length)
        .map((position) => ids[position]);
}

/** Owns intent delay and source retention independently of a reactive owner. */
export function createPreparationWindow(prepare: PrepareThread) {
  const retained = new Map<string, () => void>();
  let owner: EmailPreparation | undefined;
  let selected: string[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  function clear() {
    clearTimeout(timer);
    for (const release of retained.values()) release();
    retained.clear();
  }

  return {
    update(
      preparation: EmailPreparation | undefined,
      ids: readonly string[],
      focusedId?: string
    ) {
      if (disposed) return;
      const next = selectNeighbors(ids, focusedId);
      if (
        preparation === owner &&
        next.length === selected.length &&
        next.every((id, index) => id === selected[index])
      )
        return;
      clearTimeout(timer);
      if (preparation !== owner) {
        clear();
        owner = preparation;
      }
      selected = next;
      for (const [id, release] of retained) {
        if (!selected.includes(id)) {
          release();
          retained.delete(id);
        }
      }
      if (!preparation || !selected.length) return;
      // Pointer movement should settle before it starts speculative work.
      timer = setTimeout(() => {
        selected.forEach((id, index) => {
          if (!retained.has(id))
            retained.set(id, prepare(preparation, id, index === 0 ? 1 : 2));
        });
      }, 75);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clear();
    },
  };
}
